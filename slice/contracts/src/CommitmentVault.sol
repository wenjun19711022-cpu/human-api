// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ShareToken} from "./ShareToken.sol";
import {EscrowOffering} from "./EscrowOffering.sol";

/// @title CommitmentVault
/// @notice Turns "we will pay X every quarter" from a sales pitch into a bonded promise.
///         The merchant locks a bond up front. Each period they pay the promised dividend through this vault,
///         which distributes it to every holder. Miss the deadline (+ grace) and anyone can `slash`: the bond
///         pays holders instead and the default is recorded on-chain forever.
/// @dev `isResolved` is read by ConfidenceMarket, so prediction markets on "will they pay?" settle with no oracle.
contract CommitmentVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PeriodStatus {
        Pending,
        Paid,
        PaidLate,
        Defaulted
    }

    struct InitParams {
        address token;
        address offering;
        address merchant;
        address usdt;
        uint256 amountPerPeriod;
        uint64 periodLength;
        uint64 firstDue;
        uint32 numPeriods;
        uint64 grace;
    }

    IERC20 public usdt;
    ShareToken public token;
    EscrowOffering public offering;
    address public merchant;

    uint256 public amountPerPeriod;
    uint64 public periodLength;
    uint64 public firstDue;
    uint32 public numPeriods;
    uint64 public grace;

    uint256 public bond;
    uint32 public paidOnTime;
    uint32 public paidLate;
    uint32 public defaults;
    uint256 public totalPaid;

    mapping(uint256 => PeriodStatus) public periodStatus;
    mapping(uint256 => uint256) public periodPaidAmount;

    event BondPosted(address indexed from, uint256 amount, uint256 newBond);
    event BondWithdrawn(uint256 amount);
    event PeriodPaid(uint256 indexed period, uint256 amount, bool onTime);
    event PeriodSlashed(uint256 indexed period, uint256 slashed);
    event CommitmentRaised(uint256 oldAmount, uint256 newAmount);

    error NotMerchant();
    error BadPeriod();
    error NotPending();
    error NotYetDefaulted();
    error OfferingNotDelivered();
    error BondTooSmall();
    error NotHigher();
    error StillActive();

    constructor() {
        _disableInitializers();
    }

    function initialize(InitParams calldata p) external initializer {
        token = ShareToken(p.token);
        offering = EscrowOffering(p.offering);
        merchant = p.merchant;
        usdt = IERC20(p.usdt);
        amountPerPeriod = p.amountPerPeriod;
        periodLength = p.periodLength;
        firstDue = p.firstDue;
        numPeriods = p.numPeriods;
        grace = p.grace;
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
        bool allSettled = nextPendingPeriod() == numPeriods;
        if (!roundFailed && !allSettled) revert StillActive();
        uint256 amount = bond;
        bond = 0;
        usdt.safeTransfer(merchant, amount);
        emit BondWithdrawn(amount);
    }

    /// @notice Promise more per period ("抬高股价" with skin in the game). Bond must cover one full period.
    function raiseCommitment(uint256 newAmount) external {
        if (msg.sender != merchant) revert NotMerchant();
        if (newAmount <= amountPerPeriod) revert NotHigher();
        if (bond < newAmount) revert BondTooSmall();
        emit CommitmentRaised(amountPerPeriod, newAmount);
        amountPerPeriod = newAmount;
    }

    // ---------------------------------------------------------------- payouts

    /// @notice Pay period `i`'s promised dividend; it is distributed to holders in the same transaction.
    ///         Anyone may pay on the merchant's behalf (e.g. an automated payment agent).
    function pay(uint256 i) external nonReentrant {
        _checkPeriod(i);
        if (periodStatus[i] != PeriodStatus.Pending) revert NotPending();
        uint256 amount = amountPerPeriod;
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        bool onTime = block.timestamp <= dueDate(i) + grace;
        periodStatus[i] = onTime ? PeriodStatus.Paid : PeriodStatus.PaidLate;
        periodPaidAmount[i] = amount;
        if (onTime) paidOnTime++;
        else paidLate++;
        totalPaid += amount;
        _distribute(amount);
        emit PeriodPaid(i, amount, onTime);
    }

    /// @notice After due + grace with no payment, anyone can slash the bond to holders.
    function slash(uint256 i) external nonReentrant {
        _checkPeriod(i);
        if (periodStatus[i] != PeriodStatus.Pending) revert NotPending();
        if (block.timestamp <= dueDate(i) + grace) revert NotYetDefaulted();
        uint256 amount = bond < amountPerPeriod ? bond : amountPerPeriod;
        bond -= amount;
        periodStatus[i] = PeriodStatus.Defaulted;
        periodPaidAmount[i] = amount;
        defaults++;
        if (amount > 0) _distribute(amount);
        emit PeriodSlashed(i, amount);
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

    /// @notice Index of the first period that is still pending (numPeriods if none).
    function nextPendingPeriod() public view returns (uint256) {
        for (uint256 i; i < numPeriods; i++) {
            if (periodStatus[i] == PeriodStatus.Pending) return i;
        }
        return numPeriods;
    }

    /// @notice Promised USDT per year at the current commitment level.
    function annualizedCommitment() external view returns (uint256) {
        return (amountPerPeriod * 365 days) / periodLength;
    }

    // ---------------------------------------------------------------- internal

    function _checkPeriod(uint256 i) internal view {
        if (i >= numPeriods) revert BadPeriod();
        if (offering.phase() != EscrowOffering.Phase.Delivered) revert OfferingNotDelivered();
    }

    function _distribute(uint256 amount) internal {
        usdt.forceApprove(address(token), amount);
        token.distribute(amount);
    }
}
