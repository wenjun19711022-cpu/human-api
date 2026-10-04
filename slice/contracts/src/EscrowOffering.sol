// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceHub} from "./interfaces/ISliceHub.sol";
import {ShareToken} from "./ShareToken.sol";

/// @title EscrowOffering
/// @notice The "Taobao escrow" for buying a slice of a business. USDT sits in this contract — not with the
///         platform, not with the merchant — until the merchant has actually delivered the shares.
///
///   Subscribing ──close()──▶ Settling ──signAgreement + attestRegistration──▶ Delivered
///        │                      │                                               │
///        │ (minRaise missed)    │ (settleDeadline missed)                       ├─ confirm()         → shares minted, USDT released
///        ▼                      ▼                                               ├─ autoConfirm()     → same, after confirmWindow
///      Failed ◀─────────────────┘   refund() returns every cent                 └─ dispute()/resolve → arbitrator decides
///
/// @dev One round = one share transfer from the business to the holding vehicle, so the merchant does a single
///      registry update (工商变更 / membership ledger) instead of one per buyer. Each buyer still releases their
///      own payment by confirming receipt, exactly like 确认收货.
contract EscrowOffering is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Phase {
        Subscribing,
        Settling,
        Delivered,
        Failed
    }

    enum OrderState {
        None,
        Active,
        Confirmed,
        Disputed,
        Refunded
    }

    struct Order {
        uint256 paid;
        uint256 shares;
        OrderState state;
    }

    struct InitParams {
        address hub;
        address token;
        address merchant;
        uint256 pricePerShare; // USDT (6 dp) per 1e18 share units
        uint256 sharesForSale; // 1e18 units
        uint256 minRaise; // USDT; below this at deadline the round fails and refunds
        uint64 subscribeDeadline;
        uint64 settleWindow; // time the merchant has to sign + get the registry update attested
        uint64 confirmWindow; // after delivery, unconfirmed orders auto-confirm once this elapses
        uint16 feeBps; // platform fee taken from the merchant's proceeds
        bytes32 termsHash; // hash of the offering terms every subscriber accepts
    }

    uint256 internal constant BPS = 10_000;

    ISliceHub public hub;
    IERC20 public usdt;
    ShareToken public token;
    address public merchant;
    uint256 public pricePerShare;
    uint256 public sharesForSale;
    uint256 public minRaise;
    uint64 public subscribeDeadline;
    uint64 public settleWindow;
    uint64 public confirmWindow;
    uint16 public feeBps;
    bytes32 public termsHash;

    Phase public phase;
    uint64 public settleDeadline;
    uint64 public deliveredAt;
    bytes32 public agreementHash;
    bytes32 public registrationProof;
    address public attestedBy;

    uint256 public totalRaised;
    uint256 public sharesSold;
    uint256 public releasedToMerchant;
    uint256 public investorCount;
    mapping(address => Order) public orders;

    event Subscribed(address indexed investor, uint256 paid, uint256 shares);
    event Cancelled(address indexed investor, uint256 refunded);
    event RoundClosed(bool success, uint256 totalRaised, uint64 settleDeadline);
    event AgreementSigned(bytes32 agreementHash);
    event RegistrationAttested(address indexed verifier, bytes32 proof);
    event SettlementFailed();
    event Confirmed(address indexed investor, address indexed by, uint256 shares, uint256 toMerchant, uint256 fee);
    event Disputed(address indexed investor, bytes32 reasonHash);
    event DisputeResolved(address indexed investor, bool refunded);
    event Refunded(address indexed investor, uint256 amount);

    error WrongPhase();
    error RoundEnded();
    error RoundOpen();
    error SoldOut();
    error ZeroShares();
    error NoActiveOrder();
    error NotMerchant();
    error NotVerifier();
    error NotArbitrator();
    error NotDisputed();
    error AgreementMissing();
    error DeadlinePassed();
    error DeadlineNotReached();
    error ConfirmWindowClosed();

    constructor() {
        _disableInitializers();
    }

    function initialize(InitParams calldata p) external initializer {
        hub = ISliceHub(p.hub);
        usdt = IERC20(hub.usdt());
        token = ShareToken(p.token);
        merchant = p.merchant;
        pricePerShare = p.pricePerShare;
        sharesForSale = p.sharesForSale;
        minRaise = p.minRaise;
        subscribeDeadline = p.subscribeDeadline;
        settleWindow = p.settleWindow;
        confirmWindow = p.confirmWindow;
        feeBps = p.feeBps;
        termsHash = p.termsHash;
    }

    // ---------------------------------------------------------------- subscription

    /// @notice Lock USDT into escrow for shares at the fixed round price. Over-subscription is capped at the
    ///         remaining allocation and only the capped cost is pulled.
    function subscribe(uint256 usdtAmount) external nonReentrant returns (uint256 shares) {
        if (phase != Phase.Subscribing) revert WrongPhase();
        if (block.timestamp >= subscribeDeadline) revert RoundEnded();
        uint256 remaining = sharesForSale - sharesSold;
        if (remaining == 0) revert SoldOut();

        shares = (usdtAmount * 1e18) / pricePerShare;
        uint256 cost = usdtAmount;
        if (shares > remaining) {
            shares = remaining;
            cost = _ceilDiv(remaining * pricePerShare, 1e18);
        }
        if (shares == 0) revert ZeroShares();

        usdt.safeTransferFrom(msg.sender, address(this), cost);
        Order storage o = orders[msg.sender];
        if (o.state == OrderState.None) {
            o.state = OrderState.Active;
            investorCount++;
        }
        o.paid += cost;
        o.shares += shares;
        totalRaised += cost;
        sharesSold += shares;
        emit Subscribed(msg.sender, cost, shares);
    }

    /// @notice Cooling-off: walk away with a full refund any time before the round closes.
    function cancel() external nonReentrant {
        if (phase != Phase.Subscribing) revert WrongPhase();
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        uint256 amount = o.paid;
        totalRaised -= amount;
        sharesSold -= o.shares;
        investorCount--;
        delete orders[msg.sender];
        usdt.safeTransfer(msg.sender, amount);
        emit Cancelled(msg.sender, amount);
    }

    /// @notice Anyone can close the round once it sells out or the deadline passes.
    function close() external {
        if (phase != Phase.Subscribing) revert WrongPhase();
        if (block.timestamp < subscribeDeadline && sharesSold < sharesForSale) revert RoundOpen();
        if (totalRaised >= minRaise && totalRaised > 0) {
            phase = Phase.Settling;
            settleDeadline = uint64(block.timestamp) + settleWindow;
            emit RoundClosed(true, totalRaised, settleDeadline);
        } else {
            phase = Phase.Failed;
            emit RoundClosed(false, totalRaised, 0);
        }
    }

    // ---------------------------------------------------------------- delivery

    /// @notice Merchant signs the share transfer agreement (hash of the signed PDF).
    function signAgreement(bytes32 hash) external {
        if (msg.sender != merchant) revert NotMerchant();
        if (phase != Phase.Settling) revert WrongPhase();
        agreementHash = hash;
        emit AgreementSigned(hash);
    }

    /// @notice A platform verifier (registry check + notary) attests that the transfer is registered.
    function attestRegistration(bytes32 proof) external {
        if (!hub.isVerifier(msg.sender)) revert NotVerifier();
        if (phase != Phase.Settling) revert WrongPhase();
        if (agreementHash == bytes32(0)) revert AgreementMissing();
        if (block.timestamp > settleDeadline) revert DeadlinePassed();
        registrationProof = proof;
        attestedBy = msg.sender;
        phase = Phase.Delivered;
        deliveredAt = uint64(block.timestamp);
        emit RegistrationAttested(msg.sender, proof);
    }

    /// @notice If the merchant fails to deliver in time, anyone flips the round to Failed so everyone can refund.
    function failSettlement() external {
        if (phase != Phase.Settling) revert WrongPhase();
        if (block.timestamp <= settleDeadline) revert DeadlineNotReached();
        phase = Phase.Failed;
        emit SettlementFailed();
    }

    /// @notice 确认收货: the investor has seen the signed agreement and registry proof; release their payment.
    function confirm() external nonReentrant {
        _release(msg.sender);
    }

    /// @notice Auto-confirm, callable by anyone, once the confirm window has elapsed without a dispute.
    function autoConfirm(address investor) external nonReentrant {
        if (phase != Phase.Delivered) revert WrongPhase();
        if (block.timestamp < deliveredAt + confirmWindow) revert DeadlineNotReached();
        _release(investor);
    }

    /// @notice Freeze your own order for arbitration (e.g. the registry record does not show the transfer).
    function dispute(bytes32 reasonHash) external {
        if (phase != Phase.Delivered) revert WrongPhase();
        if (block.timestamp >= deliveredAt + confirmWindow) revert ConfirmWindowClosed();
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        o.state = OrderState.Disputed;
        emit Disputed(msg.sender, reasonHash);
    }

    function resolveDispute(address investor, bool refund_) external nonReentrant {
        if (!hub.isArbitrator(msg.sender)) revert NotArbitrator();
        Order storage o = orders[investor];
        if (o.state != OrderState.Disputed) revert NotDisputed();
        if (refund_) {
            o.state = OrderState.Refunded;
            usdt.safeTransfer(investor, o.paid);
            emit Refunded(investor, o.paid);
        } else {
            o.state = OrderState.Active;
            _release(investor);
        }
        emit DisputeResolved(investor, refund_);
    }

    /// @notice Full refund when the round failed (minRaise missed or merchant never delivered).
    function refund() external nonReentrant {
        if (phase != Phase.Failed) revert WrongPhase();
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        o.state = OrderState.Refunded;
        usdt.safeTransfer(msg.sender, o.paid);
        emit Refunded(msg.sender, o.paid);
    }

    // ---------------------------------------------------------------- views

    function progressBps() external view returns (uint256) {
        return sharesForSale == 0 ? 0 : (sharesSold * BPS) / sharesForSale;
    }

    function autoConfirmAt() external view returns (uint64) {
        return deliveredAt == 0 ? 0 : deliveredAt + confirmWindow;
    }

    // ---------------------------------------------------------------- internal

    function _release(address investor) internal {
        if (phase != Phase.Delivered) revert WrongPhase();
        Order storage o = orders[investor];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        o.state = OrderState.Confirmed;
        uint256 fee = (o.paid * feeBps) / BPS;
        uint256 toMerchant = o.paid - fee;
        releasedToMerchant += toMerchant;
        token.mint(investor, o.shares);
        if (fee > 0) usdt.safeTransfer(hub.treasury(), fee);
        usdt.safeTransfer(merchant, toMerchant);
        emit Confirmed(investor, msg.sender, o.shares, toMerchant, fee);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
