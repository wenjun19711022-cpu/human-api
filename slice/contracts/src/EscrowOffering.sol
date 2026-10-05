// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceHub, IPlatformFeeSink} from "./interfaces/ISliceHub.sol";
import {ShareToken} from "./ShareToken.sol";

/// @title EscrowOffering
/// @notice A launch round that works like Taobao escrow, priced like a fair auction.
///
/// Pricing — uniform-price batch auction
///   Every investor names the highest price they accept (a tick on a ladder that starts at the floor price) and
///   how much USDT to commit. At the deadline the contract finds ONE clearing price for everybody:
///     - the highest price at which demand still covers the shares for sale;
///     - everyone who bid above it fills completely at that same price;
///     - bidders exactly at the clearing tick share what is left pro rata;
///     - bidders below it are refunded in full, immediately.
///   A single-tick ladder is a fixed-price round with pro-rata allocation. Nobody wins by being fast, so an investor
///   asleep in Tokyo gets the same deal as a bot in New York.
///
/// Escrow — nobody touches the money until the shares exist
///   Subscribing ──close() at deadline──▶ Settling ──sign + verifier attests registry──▶ Delivered
///        │                                  │                                             ├─ confirm()       → shares minted, merchant paid
///        │ (minRaise missed)                │ (settleDeadline missed)                     ├─ autoConfirm()   → same, after confirmWindow
///        ▼                                  ▼                                             └─ dispute()       → arbitrator, with a timeout
///      Failed ◀─────────────────────────────┘   refund() returns every cent
///
/// Anti-abuse rules
///   - No cancelling in the last CANCEL_CUTOFF before the deadline: a whale cannot pull out at the last second
///     and sink the round after everyone else stopped watching.
///   - The settlement deadline counts from the subscription deadline, not from whenever someone calls close(),
///     so the first dividend date (checked by SliceHub) is always after every investor holds their shares.
///   - A dispute costs a DISPUTE_BOND_BPS bond: returned if the investor is right, paid to the merchant if not.
///     That stops "dispute" from being a free option to back out after delivery. If the arbitrator does not rule
///     within ARBITRATION_WINDOW, the investor can take a full refund themselves.
///
/// Fees: `upfrontFeeBps` goes to the treasury on release; `vestedFeeBps` goes to the CommitmentVault and is only
/// paid to the platform as dividends are honoured on time (see CommitmentVault).
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
        uint256 budget; // USDT escrowed
        uint256 withdrawn; // unfilled remainder already returned
        uint256 disputeBond;
        uint64 disputedAt;
        uint8 tick; // highest acceptable price = prices[tick]
        OrderState state;
    }

    struct InitParams {
        address hub;
        address token;
        address vault;
        address merchant;
        uint256 floorPrice; // USDT (6 dp) per 1e18 share units at tick 0
        uint16 tickBps; // price step between ticks, e.g. 500 = +5%
        uint8 numTicks; // 1 = fixed price
        uint256 sharesForSale; // 1e18 units
        uint256 minRaise; // USDT; below this the round fails and refunds
        uint64 subscribeDeadline;
        uint64 settleWindow;
        uint64 confirmWindow;
        uint16 upfrontFeeBps;
        uint16 vestedFeeBps;
        bytes32 termsHash;
    }

    uint256 internal constant BPS = 10_000;
    uint8 public constant MAX_TICKS = 32;
    uint64 public constant CANCEL_CUTOFF = 2 days;
    uint16 public constant DISPUTE_BOND_BPS = 200;
    uint64 public constant ARBITRATION_WINDOW = 14 days;

    ISliceHub public hub;
    IERC20 public usdt;
    ShareToken public token;
    IPlatformFeeSink public vault;
    address public merchant;
    uint256[] internal _prices;
    uint256 public sharesForSale;
    uint256 public minRaise;
    uint64 public subscribeDeadline;
    uint64 public settleWindow;
    uint64 public confirmWindow;
    uint16 public upfrontFeeBps;
    uint16 public vestedFeeBps;
    bytes32 public termsHash;

    Phase public phase;
    uint64 public settleDeadline;
    uint64 public deliveredAt;
    bytes32 public agreementHash;
    bytes32 public registrationProof;
    address public attestedBy;

    mapping(uint256 => uint256) public tickBudget;
    uint256 public totalBudget;
    uint256 public investorCount;

    // Set once at close().
    uint256 public clearingPrice;
    uint8 public clearingTick;
    bool public filledAtFloor; // demand never covered supply: everyone fills at the floor price
    uint256 public marginalSpend; // USDT spent by the clearing tick in total
    uint256 public totalRaised;
    uint256 public releasedToMerchant;

    mapping(address => Order) public orders;

    event Bid(address indexed investor, uint8 tick, uint256 amount, uint256 budget);
    event Cancelled(address indexed investor, uint256 refunded);
    event RoundClosed(bool success, uint256 clearingPrice, uint256 totalRaised, uint64 settleDeadline);
    event UnfilledWithdrawn(address indexed investor, uint256 amount);
    event AgreementSigned(bytes32 agreementHash);
    event RegistrationAttested(address indexed verifier, bytes32 proof);
    event SettlementFailed();
    event Confirmed(address indexed investor, address indexed by, uint256 shares, uint256 cost, uint256 toMerchant);
    event Disputed(address indexed investor, bytes32 reasonHash, uint256 bond);
    event DisputeResolved(address indexed investor, bool refunded);
    event Refunded(address indexed investor, uint256 amount);

    error WrongPhase();
    error RoundEnded();
    error RoundOpen();
    error BadTick();
    error TickMismatch();
    error ZeroAmount();
    error CancelWindowClosed();
    error NoActiveOrder();
    error NothingToWithdraw();
    error NotMerchant();
    error NotVerifier();
    error NotArbitrator();
    error NotDisputed();
    error AgreementMissing();
    error DeadlinePassed();
    error DeadlineNotReached();
    error ConfirmWindowClosed();
    error NothingFilled();
    error BadParams();

    constructor() {
        _disableInitializers();
    }

    function initialize(InitParams calldata p) external initializer {
        if (p.numTicks == 0 || p.numTicks > MAX_TICKS || p.floorPrice == 0) revert BadParams();
        hub = ISliceHub(p.hub);
        usdt = IERC20(hub.usdt());
        token = ShareToken(p.token);
        vault = IPlatformFeeSink(p.vault);
        merchant = p.merchant;
        uint256 price = p.floorPrice;
        for (uint256 i; i < p.numTicks; i++) {
            _prices.push(price);
            price = (price * (BPS + p.tickBps)) / BPS;
        }
        sharesForSale = p.sharesForSale;
        minRaise = p.minRaise;
        subscribeDeadline = p.subscribeDeadline;
        settleWindow = p.settleWindow;
        confirmWindow = p.confirmWindow;
        upfrontFeeBps = p.upfrontFeeBps;
        vestedFeeBps = p.vestedFeeBps;
        termsHash = p.termsHash;
    }

    // ---------------------------------------------------------------- bidding

    /// @notice Escrow `amount` USDT with a maximum acceptable price of prices(tick). Top up any time before the
    ///         deadline at the same tick; to move your price, cancel and bid again (before the cancel cutoff).
    function bid(uint8 tick, uint256 amount) external nonReentrant {
        if (phase != Phase.Subscribing) revert WrongPhase();
        if (block.timestamp >= subscribeDeadline) revert RoundEnded();
        if (tick >= _prices.length) revert BadTick();
        if (amount == 0) revert ZeroAmount();
        Order storage o = orders[msg.sender];
        if (o.state == OrderState.None) {
            o.state = OrderState.Active;
            o.tick = tick;
            investorCount++;
        } else if (o.tick != tick) {
            revert TickMismatch();
        }
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        o.budget += amount;
        tickBudget[tick] += amount;
        totalBudget += amount;
        emit Bid(msg.sender, tick, amount, o.budget);
    }

    /// @notice Cooling-off: full refund, until CANCEL_CUTOFF before the deadline.
    function cancel() external nonReentrant {
        if (phase != Phase.Subscribing) revert WrongPhase();
        if (block.timestamp + CANCEL_CUTOFF >= subscribeDeadline) revert CancelWindowClosed();
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        uint256 amount = o.budget;
        tickBudget[o.tick] -= amount;
        totalBudget -= amount;
        investorCount--;
        delete orders[msg.sender];
        usdt.safeTransfer(msg.sender, amount);
        emit Cancelled(msg.sender, amount);
    }

    /// @notice Anyone closes the round after the deadline; this fixes the clearing price for everybody.
    function close() external {
        if (phase != Phase.Subscribing) revert WrongPhase();
        if (block.timestamp < subscribeDeadline) revert RoundOpen();
        (uint8 tick, uint256 price, bool atFloor, uint256 marginal, uint256 raised) = previewClearing();
        clearingTick = tick;
        clearingPrice = price;
        filledAtFloor = atFloor;
        marginalSpend = marginal;
        totalRaised = raised;
        if (raised >= minRaise && raised > 0) {
            phase = Phase.Settling;
            settleDeadline = subscribeDeadline + settleWindow;
            emit RoundClosed(true, price, raised, settleDeadline);
        } else {
            phase = Phase.Failed;
            emit RoundClosed(false, price, raised, 0);
        }
    }

    /// @notice Take back the part of your budget that did not fill, right after close.
    function withdrawUnfilled() external nonReentrant {
        if (phase != Phase.Settling && phase != Phase.Delivered) revert WrongPhase();
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Active && o.state != OrderState.Disputed) revert NoActiveOrder();
        uint256 amount = _unfilled(msg.sender, o);
        if (amount == 0) revert NothingToWithdraw();
        o.withdrawn += amount;
        usdt.safeTransfer(msg.sender, amount);
        emit UnfilledWithdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- delivery

    function signAgreement(bytes32 hash) external {
        if (msg.sender != merchant) revert NotMerchant();
        if (phase != Phase.Settling) revert WrongPhase();
        agreementHash = hash;
        emit AgreementSigned(hash);
    }

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

    function failSettlement() external {
        if (phase != Phase.Settling) revert WrongPhase();
        if (block.timestamp <= settleDeadline) revert DeadlineNotReached();
        phase = Phase.Failed;
        emit SettlementFailed();
    }

    /// @notice 确认收货: release your payment to the merchant and receive your shares (plus any unfilled remainder).
    function confirm() external nonReentrant {
        _release(msg.sender);
    }

    function autoConfirm(address investor) external nonReentrant {
        if (phase != Phase.Delivered) revert WrongPhase();
        if (block.timestamp < deliveredAt + confirmWindow) revert DeadlineNotReached();
        _release(investor);
    }

    /// @notice Freeze your order for arbitration. Posts a bond of DISPUTE_BOND_BPS of your filled amount.
    function dispute(bytes32 reasonHash) external nonReentrant {
        if (phase != Phase.Delivered) revert WrongPhase();
        if (block.timestamp >= deliveredAt + confirmWindow) revert ConfirmWindowClosed();
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        (, uint256 cost) = allocation(msg.sender);
        if (cost == 0) revert NothingFilled();
        uint256 bond = (cost * DISPUTE_BOND_BPS) / BPS;
        if (bond > 0) usdt.safeTransferFrom(msg.sender, address(this), bond);
        o.disputeBond = bond;
        o.disputedAt = uint64(block.timestamp);
        o.state = OrderState.Disputed;
        emit Disputed(msg.sender, reasonHash, bond);
    }

    /// @notice Arbitrator rules. Refund: investor gets everything back incl. bond. Otherwise the order releases
    ///         normally and the bond compensates the merchant for the delay.
    function resolveDispute(address investor, bool refund_) external nonReentrant {
        if (!hub.isArbitrator(msg.sender)) revert NotArbitrator();
        Order storage o = orders[investor];
        if (o.state != OrderState.Disputed) revert NotDisputed();
        uint256 bond = o.disputeBond;
        o.disputeBond = 0;
        if (refund_) {
            _refundAll(investor, o, bond);
        } else {
            o.state = OrderState.Active;
            if (bond > 0) usdt.safeTransfer(merchant, bond);
            _release(investor);
        }
        emit DisputeResolved(investor, refund_);
    }

    /// @notice The platform failed to rule in time: the investor takes a full refund on their own.
    function claimArbitrationTimeout() external nonReentrant {
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Disputed) revert NotDisputed();
        if (block.timestamp <= o.disputedAt + ARBITRATION_WINDOW) revert DeadlineNotReached();
        uint256 bond = o.disputeBond;
        o.disputeBond = 0;
        _refundAll(msg.sender, o, bond);
    }

    /// @notice Full refund (minus anything already withdrawn) when the round failed.
    function refund() external nonReentrant {
        if (phase != Phase.Failed) revert WrongPhase();
        Order storage o = orders[msg.sender];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        _refundAll(msg.sender, o, 0);
    }

    // ---------------------------------------------------------------- views

    function prices(uint256 tick) external view returns (uint256) {
        return _prices[tick];
    }

    function numTicks() external view returns (uint256) {
        return _prices.length;
    }

    /// @notice Demand ladder for charts: price and committed USDT at every tick.
    function demandCurve() external view returns (uint256[] memory px, uint256[] memory budget) {
        uint256 n = _prices.length;
        px = new uint256[](n);
        budget = new uint256[](n);
        for (uint256 i; i < n; i++) {
            px[i] = _prices[i];
            budget[i] = tickBudget[i];
        }
    }

    /// @notice The clearing result if the round closed now. close() stores exactly this.
    /// @return tick      clearing tick (0 when filled at floor)
    /// @return price     uniform price every filled investor pays
    /// @return atFloor   true when demand never covered supply, so every bid fills at the floor
    /// @return marginal  USDT the clearing tick spends in total (pro rata across its bidders)
    /// @return raised    total USDT that will be released to the merchant side
    function previewClearing() public view returns (uint8 tick, uint256 price, bool atFloor, uint256 marginal, uint256 raised) {
        uint256 supply = sharesForSale;
        uint256 above;
        for (uint256 i = _prices.length; i > 0; i--) {
            uint256 t = i - 1;
            uint256 withTick = above + tickBudget[t];
            if ((withTick * 1e18) / _prices[t] >= supply) {
                // Bidders above t alone may already cover supply at prices[t]: then the price rises until they
                // exactly cover it (still below the next tick), and tick t gets nothing.
                price = _max(_prices[t], _ceilDiv(above * 1e18, supply));
                if (price == _prices[t]) {
                    uint256 left = supply - (above * 1e18) / price;
                    marginal = (left * price) / 1e18;
                    if (marginal > tickBudget[t]) marginal = tickBudget[t];
                }
                return (uint8(t), price, false, marginal, above + marginal);
            }
            above = withTick;
        }
        return (0, _prices[0], true, tickBudget[0], totalBudget);
    }

    /// @notice What `who` gets at the clearing price: shares and the USDT that pays for them.
    function allocation(address who) public view returns (uint256 shares, uint256 cost) {
        if (phase == Phase.Subscribing || phase == Phase.Failed) return (0, 0);
        Order storage o = orders[who];
        if (o.state == OrderState.None) return (0, 0);
        if (filledAtFloor || o.tick > clearingTick) cost = o.budget;
        else if (o.tick == clearingTick && marginalSpend > 0) cost = (o.budget * marginalSpend) / tickBudget[clearingTick];
        shares = (cost * 1e18) / clearingPrice;
    }

    /// @notice Demand at the floor price relative to supply, in bps (12_000 = 1.2x oversubscribed).
    function coverageBps() external view returns (uint256) {
        return (((totalBudget * 1e18) / _prices[0]) * BPS) / sharesForSale;
    }

    function autoConfirmAt() external view returns (uint64) {
        return deliveredAt == 0 ? 0 : deliveredAt + confirmWindow;
    }

    // ---------------------------------------------------------------- internal

    function _unfilled(address who, Order storage o) internal view returns (uint256) {
        (, uint256 cost) = allocation(who);
        return o.budget - cost - o.withdrawn;
    }

    function _release(address investor) internal {
        if (phase != Phase.Delivered) revert WrongPhase();
        Order storage o = orders[investor];
        if (o.state != OrderState.Active) revert NoActiveOrder();
        (uint256 shares, uint256 cost) = allocation(investor);
        uint256 leftover = o.budget - cost - o.withdrawn;
        o.state = OrderState.Confirmed;
        o.withdrawn += leftover;

        uint256 upfront = (cost * upfrontFeeBps) / BPS;
        uint256 vested = (cost * vestedFeeBps) / BPS;
        uint256 toMerchant = cost - upfront - vested;
        releasedToMerchant += toMerchant;

        if (shares > 0) token.mint(investor, shares);
        if (upfront > 0) usdt.safeTransfer(hub.treasury(), upfront);
        if (vested > 0) {
            usdt.forceApprove(address(vault), vested);
            vault.depositPlatformFee(vested);
        }
        if (toMerchant > 0) usdt.safeTransfer(merchant, toMerchant);
        if (leftover > 0) usdt.safeTransfer(investor, leftover);
        emit Confirmed(investor, msg.sender, shares, cost, toMerchant);
    }

    function _refundAll(address investor, Order storage o, uint256 bond) internal {
        uint256 amount = o.budget - o.withdrawn + bond;
        o.withdrawn = o.budget;
        o.state = OrderState.Refunded;
        usdt.safeTransfer(investor, amount);
        emit Refunded(investor, amount);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
