// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceHub, IPlatformFeeSink} from "./interfaces/ISliceHub.sol";
import {ShareToken} from "./ShareToken.sol";
import {EscrowOffering} from "./EscrowOffering.sol";

/// @title CommitmentVault
/// @notice Turns "we will pay X every quarter" from a sales pitch into a bonded promise.
///
///   - Bond: posted at launch, sized by SliceHub from the AI trust score and the merchant's default history.
///   - Installments: anyone can `contribute` any amount at any time (a bar can pay weekly from the till, a
///     RevenueRouter pays straight from the source). Money is distributed to holders immediately and credited to
///     the earliest unsettled period; a period counts as paid once its credit reaches the promise.
///   - Slashing: after due date + grace, anyone can `slash` a short period. Only the shortfall comes out of the
///     bond, it goes to holders, and the default is reported to the hub (raising the merchant's future bonds).
///   - Platform fee vesting: the vested part of the launch fee sits here. Each period settled on time releases one
///     slice to the platform; a late or defaulted period's slice goes to holders instead. The platform only earns
///     in full if investors are paid in full.
/// @dev `isResolved` is read by ConfidenceMarket, so prediction markets on "will they pay?" settle with no oracle.
contract CommitmentVault is Initializable, ReentrancyGuard, IPlatformFeeSink {
    using SafeERC20 for IERC20;

    enum PeriodStatus {
        Pending,
        Paid,
        PaidLate,
        Defaulted
    }

    struct InitParams {
        address hub;
        address token;
        address offering;
        address merchant;
        uint256 amountPerPeriod;
        uint64 periodLength;
        uint64 firstDue;
        uint32 numPeriods;
        uint64 grace;
        uint32 bondPeriods; // bond must keep covering this many periods when the promise is raised
    }

    ISliceHub public hub;
    IERC20 public usdt;
    ShareToken public token;
    EscrowOffering public offering;
    address public merchant;

    uint256 public amountPerPeriod;
    uint64 public periodLength;
    uint64 public firstDue;
    uint32 public numPeriods;
    uint64 public grace;
    uint32 public bondPeriods;

    uint256 public bond;
    uint32 public paidOnTime;
    uint32 public paidLate;
    uint32 public defaults;
    uint32 public settledPeriods;
    uint256 public totalPaid; // everything distributed through this vault (promises, bonuses, slashed bond)
    uint256 public feeRemaining; // vested platform fee not yet released
    uint256 internal _cursor; // first period that may still be pending

    mapping(uint256 => PeriodStatus) public periodStatus;
    mapping(uint256 => uint256) public periodCredit;
    mapping(uint256 => uint256) public periodPaidAmount;

    event BondPosted(address indexed from, uint256 amount, uint256 newBond);
    event BondWithdrawn(uint256 amount);
    event Contributed(address indexed from, uint256 amount);
    event PeriodPaid(uint256 indexed period, uint256 amount, bool onTime);
    event PeriodSlashed(uint256 indexed period, uint256 slashed);
    event CommitmentRaised(uint256 oldAmount, uint256 newAmount);
    event PlatformFeeDeposited(uint256 amount);
    event PlatformFeeSettled(uint256 indexed period, uint256 amount, bool toPlatform);

    error NotMerchant();
    error NotOffering();
    error BadPeriod();
    error NotPending();
    error NotYetDefaulted();
    error OfferingNotDelivered();
    error BondTooSmall();
    error NotHigher();
    error StillActive();
    error ZeroAmount();

    constructor() {
        _disableInitializers();
    }

    function initialize(InitParams calldata p) external initializer {
        hub = ISliceHub(p.hub);
        usdt = IERC20(hub.usdt());
        token = ShareToken(p.token);
        offering = EscrowOffering(p.offering);
        merchant = p.merchant;
        amountPerPeriod = p.amountPerPeriod;
        periodLength = p.periodLength;
        firstDue = p.firstDue;
        numPeriods = p.numPeriods;
        grace = p.grace;
        bondPeriods = p.bondPeriods == 0 ? 1 : p.bondPeriods;
    }

    // ---------------------------------------------------------------- bond

    function postBond(uint256 amount) external nonReentrant {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        bond += amount;
        emit BondPosted(msg.sender, amount, bond);
    }

    /// @notice Bond comes back once every period is settled, or immediately if the round never delivered.
    function withdrawBond() external nonReentrant {
        if (msg.sender != merchant) revert NotMerchant();
        bool roundFailed = offering.phase() == EscrowOffering.Phase.Failed;
        if (!roundFailed && settledPeriods < numPeriods) revert StillActive();
        uint256 amount = bond;
        bond = 0;
        usdt.safeTransfer(merchant, amount);
        emit BondWithdrawn(amount);
    }

    /// @notice Promise more per period ("抬高股价" with skin in the game). The bond must still cover `bondPeriods`.
    function raiseCommitment(uint256 newAmount) external {
        if (msg.sender != merchant) revert NotMerchant();
        if (newAmount <= amountPerPeriod) revert NotHigher();
        if (bond < newAmount * bondPeriods) revert BondTooSmall();
        emit CommitmentRaised(amountPerPeriod, newAmount);
        amountPerPeriod = newAmount;
    }

    // ---------------------------------------------------------------- payouts

    /// @notice Pay any amount towards the promise. It reaches holders at once and fills the earliest open period;
    ///         anything beyond every remaining period is simply a bonus dividend.
    function contribute(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _requireDelivered();
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        _distribute(amount);
        totalPaid += amount;
        emit Contributed(msg.sender, amount);

        uint256 left = amount;
        for (uint256 i = _cursor; i < numPeriods && left > 0; i++) {
            if (periodStatus[i] != PeriodStatus.Pending) continue;
            uint256 need = amountPerPeriod - periodCredit[i];
            uint256 take = left < need ? left : need;
            periodCredit[i] += take;
            left -= take;
            if (periodCredit[i] == amountPerPeriod) _settlePaid(i);
        }
        _advanceCursor();
    }

    /// @notice Pay whatever is still missing for period `i`.
    function pay(uint256 i) external nonReentrant {
        _checkPeriod(i);
        if (periodStatus[i] != PeriodStatus.Pending) revert NotPending();
        uint256 missing = amountPerPeriod - periodCredit[i];
        usdt.safeTransferFrom(msg.sender, address(this), missing);
        _distribute(missing);
        totalPaid += missing;
        periodCredit[i] = amountPerPeriod;
        _settlePaid(i);
        _advanceCursor();
    }

    /// @notice After due + grace with the promise unmet, anyone can slash: the bond covers the shortfall.
    function slash(uint256 i) external nonReentrant {
        _checkPeriod(i);
        if (periodStatus[i] != PeriodStatus.Pending) revert NotPending();
        if (block.timestamp <= dueDate(i) + grace) revert NotYetDefaulted();
        uint256 missing = amountPerPeriod - periodCredit[i];
        uint256 taken = bond < missing ? bond : missing;
        bond -= taken;
        periodStatus[i] = PeriodStatus.Defaulted;
        periodPaidAmount[i] = periodCredit[i] + taken;
        defaults++;
        if (taken > 0) {
            _distribute(taken);
            totalPaid += taken;
        }
        _settleFee(i, false);
        _advanceCursor();
        hub.recordDefault(merchant);
        emit PeriodSlashed(i, taken);
    }

    /// @notice Vested launch fee arriving from the offering as investors confirm receipt.
    function depositPlatformFee(uint256 amount) external {
        if (msg.sender != address(offering)) revert NotOffering();
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        if (settledPeriods >= numPeriods) {
            usdt.safeTransfer(hub.treasury(), amount); // very late confirmation after every period settled
        } else {
            feeRemaining += amount;
        }
        emit PlatformFeeDeposited(amount);
    }

    // ---------------------------------------------------------------- views

    function dueDate(uint256 i) public view returns (uint64) {
        return firstDue + uint64(i) * periodLength;
    }

    /// @return resolved whether period `i` has a final answer
    /// @return honored true only if it was paid in full on time
    function isResolved(uint256 i) external view returns (bool resolved, bool honored) {
        PeriodStatus s = periodStatus[i];
        if (s == PeriodStatus.Paid) return (true, true);
        if (s == PeriodStatus.PaidLate || s == PeriodStatus.Defaulted) return (true, false);
        if (block.timestamp > dueDate(i) + grace) return (true, false);
        return (false, false);
    }

    function nextPendingPeriod() public view returns (uint256) {
        for (uint256 i = _cursor; i < numPeriods; i++) {
            if (periodStatus[i] == PeriodStatus.Pending) return i;
        }
        return numPeriods;
    }

    /// @notice Still owed for period `i` (0 once settled).
    function shortfall(uint256 i) external view returns (uint256) {
        if (periodStatus[i] != PeriodStatus.Pending) return 0;
        return amountPerPeriod - periodCredit[i];
    }

    function annualizedCommitment() external view returns (uint256) {
        return (amountPerPeriod * 365 days) / periodLength;
    }

    /// @notice How many periods the bond can still cover, in bps (10_000 = exactly one period).
    function bondCoverageBps() external view returns (uint256) {
        return (bond * 10_000) / amountPerPeriod;
    }

    // ---------------------------------------------------------------- internal

    function _settlePaid(uint256 i) internal {
        bool onTime = block.timestamp <= dueDate(i) + grace;
        periodStatus[i] = onTime ? PeriodStatus.Paid : PeriodStatus.PaidLate;
        periodPaidAmount[i] = periodCredit[i];
        if (onTime) paidOnTime++;
        else paidLate++;
        _settleFee(i, onTime);
        emit PeriodPaid(i, periodCredit[i], onTime);
    }

    /// @dev One slice of the vested fee per settled period: to the platform if honoured, else to holders.
    function _settleFee(uint256 i, bool honored) internal {
        uint256 left = numPeriods - settledPeriods;
        settledPeriods++;
        if (feeRemaining == 0) return;
        uint256 slice = left == 1 ? feeRemaining : feeRemaining / left;
        feeRemaining -= slice;
        if (honored) {
            usdt.safeTransfer(hub.treasury(), slice);
        } else {
            _distribute(slice);
            totalPaid += slice;
        }
        emit PlatformFeeSettled(i, slice, honored);
    }

    function _advanceCursor() internal {
        uint256 c = _cursor;
        while (c < numPeriods && periodStatus[c] != PeriodStatus.Pending) c++;
        _cursor = c;
    }

    function _checkPeriod(uint256 i) internal view {
        if (i >= numPeriods) revert BadPeriod();
        _requireDelivered();
    }

    function _requireDelivered() internal view {
        if (offering.phase() != EscrowOffering.Phase.Delivered) revert OfferingNotDelivered();
    }

    function _distribute(uint256 amount) internal {
        usdt.forceApprove(address(token), amount);
        token.distribute(amount);
    }
}
