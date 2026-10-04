// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceHub} from "./interfaces/ISliceHub.sol";
import {CommitmentVault} from "./CommitmentVault.sol";

/// @title ConfidenceMarket
/// @notice Polymarket-style YES/NO pools on "Will <business> pay period N's promised dividend on time?"
///         The YES share of the pool is a live, crowd-priced credit signal for every listed business, and
///         holders can buy NO to hedge their position. Resolution reads CommitmentVault directly — the payment
///         either happened on-chain or it did not — so there is no oracle to trust or bribe.
/// @dev Parimutuel: winners split the losing pool pro rata (minus a fee on the losing pool only, so a winner
///      never gets back less than they staked). If nobody bet on the winning side, everyone is refunded.
contract ConfidenceMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Market {
        CommitmentVault vault;
        uint32 period;
        uint64 closesAt;
        uint256 yesPool;
        uint256 noPool;
        bool resolved;
        bool yesWon;
    }

    uint256 internal constant BPS = 10_000;

    ISliceHub public immutable hub;
    IERC20 public immutable usdt;
    uint16 public immutable feeBps;

    Market[] internal _markets;
    mapping(bytes32 => uint256) public marketIdPlusOne;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event MarketCreated(uint256 indexed id, address indexed vault, uint32 period, uint64 closesAt);
    event Bet(uint256 indexed id, address indexed user, bool yes, uint256 amount);
    event Resolved(uint256 indexed id, bool yesWon, uint256 fee);
    event Claimed(uint256 indexed id, address indexed user, uint256 payout);

    error UnknownVault();
    error BadPeriod();
    error MarketExists();
    error MarketClosed();
    error NotResolvable();
    error AlreadyResolved();
    error NotResolved();
    error AlreadyClaimed();
    error InsiderBet();
    error ZeroAmount();

    constructor(address hub_, uint16 feeBps_) {
        hub = ISliceHub(hub_);
        usdt = IERC20(ISliceHub(hub_).usdt());
        feeBps = feeBps_;
    }

    function createMarket(address vault, uint32 period) external returns (uint256 id) {
        if (!hub.isVault(vault)) revert UnknownVault();
        CommitmentVault v = CommitmentVault(vault);
        if (period >= v.numPeriods()) revert BadPeriod();
        bytes32 key = keccak256(abi.encode(vault, period));
        if (marketIdPlusOne[key] != 0) revert MarketExists();
        uint64 closesAt = v.dueDate(period);
        if (block.timestamp >= closesAt) revert MarketClosed();
        id = _markets.length;
        _markets.push(
            Market({vault: v, period: period, closesAt: closesAt, yesPool: 0, noPool: 0, resolved: false, yesWon: false})
        );
        marketIdPlusOne[key] = id + 1;
        emit MarketCreated(id, vault, period, closesAt);
    }

    function bet(uint256 id, bool yes, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Market storage m = _markets[id];
        if (block.timestamp >= m.closesAt) revert MarketClosed();
        // The merchant decides the outcome, so the merchant may not trade it.
        if (msg.sender == m.vault.merchant()) revert InsiderBet();
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        if (yes) {
            m.yesPool += amount;
            yesStake[id][msg.sender] += amount;
        } else {
            m.noPool += amount;
            noStake[id][msg.sender] += amount;
        }
        emit Bet(id, msg.sender, yes, amount);
    }

    function resolve(uint256 id) external {
        Market storage m = _markets[id];
        if (m.resolved) revert AlreadyResolved();
        (bool resolved, bool honored) = m.vault.isResolved(m.period);
        if (!resolved) revert NotResolvable();
        m.resolved = true;
        m.yesWon = honored;
        uint256 winning = honored ? m.yesPool : m.noPool;
        uint256 losing = honored ? m.noPool : m.yesPool;
        uint256 fee;
        if (winning > 0 && losing > 0) {
            fee = (losing * feeBps) / BPS;
            if (fee > 0) usdt.safeTransfer(hub.treasury(), fee);
        }
        emit Resolved(id, honored, fee);
    }

    function claim(uint256 id) external nonReentrant returns (uint256 payout) {
        Market storage m = _markets[id];
        if (!m.resolved) revert NotResolved();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        claimed[id][msg.sender] = true;
        payout = payoutOf(id, msg.sender);
        if (payout > 0) usdt.safeTransfer(msg.sender, payout);
        emit Claimed(id, msg.sender, payout);
    }

    // ---------------------------------------------------------------- views

    function payoutOf(uint256 id, address user) public view returns (uint256) {
        Market storage m = _markets[id];
        if (!m.resolved) return 0;
        uint256 winning = m.yesWon ? m.yesPool : m.noPool;
        uint256 losing = m.yesWon ? m.noPool : m.yesPool;
        uint256 stake = m.yesWon ? yesStake[id][user] : noStake[id][user];
        if (winning == 0) {
            // Nobody backed the right answer: refund the (losing-side) stakes.
            return m.yesWon ? noStake[id][user] : yesStake[id][user];
        }
        if (stake == 0) return 0;
        uint256 distributable = losing - (losing * feeBps) / BPS;
        return stake + (stake * distributable) / winning;
    }

    /// @notice Implied probability (bps) that the merchant pays on time. 5000 when the market is empty.
    function yesPriceBps(uint256 id) external view returns (uint256) {
        Market storage m = _markets[id];
        uint256 total = m.yesPool + m.noPool;
        return total == 0 ? 5000 : (m.yesPool * BPS) / total;
    }

    function market(uint256 id) external view returns (Market memory) {
        return _markets[id];
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }
}
