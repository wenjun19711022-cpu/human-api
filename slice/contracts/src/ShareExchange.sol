// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceHub} from "./interfaces/ISliceHub.sol";
import {ShareToken} from "./ShareToken.sol";

/// @title ShareExchange
/// @notice Fully on-chain central limit order book for every ShareToken against USDT.
///         - Limit orders rest in price-time priority; crossing orders fill at the resting (maker) price.
///         - Market orders ("spend $50" / "sell everything") sweep the book and never rest.
///         - Sell orders do not move tokens: the exchange locks them inside the seller's balance, so the seller
///           keeps earning dividends until the moment the order fills.
///         - Takers pay `takerFeeBps`; makers pay nothing.
/// @dev Prices are USDT (6 dp) per 1e18 share units. Book traversal is O(n) on insert, bounded on match.
contract ShareExchange is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address maker;
        address token;
        bool isBuy;
        bool active;
        uint64 prev;
        uint64 next;
        uint256 price;
        uint256 remaining;
        uint256 escrow; // USDT still held for a resting buy
    }

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_MATCHES = 64;

    ISliceHub public immutable hub;
    IERC20 public immutable usdt;
    uint16 public immutable takerFeeBps;

    uint64 public nextOrderId = 1;
    mapping(uint64 => Order) public orders;
    mapping(address => uint64) public bestBid;
    mapping(address => uint64) public bestAsk;
    mapping(address => uint256) public lastPrice;

    event OrderPlaced(
        uint64 indexed id, address indexed maker, address indexed token, bool isBuy, uint256 price, uint256 amount
    );
    event OrderCancelled(uint64 indexed id);
    event OrderFilled(uint64 indexed id);
    event Trade(
        address indexed token,
        uint64 indexed makerOrderId,
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool takerIsBuy
    );

    error UnknownToken();
    error ZeroAmount();
    error NotMaker();
    error Inactive();
    error Slippage();

    constructor(address hub_, uint16 takerFeeBps_) {
        hub = ISliceHub(hub_);
        usdt = IERC20(ISliceHub(hub_).usdt());
        takerFeeBps = takerFeeBps_;
    }

    // ---------------------------------------------------------------- limit orders

    function placeLimit(address token, bool isBuy, uint256 price, uint256 amount)
        external
        nonReentrant
        returns (uint64 id, uint256 filled)
    {
        if (!hub.isShareToken(token)) revert UnknownToken();
        if (price == 0 || amount == 0) revert ZeroAmount();

        if (isBuy) {
            uint256 maxCost = _ceilCost(price, amount);
            uint256 pulled = maxCost + (maxCost * takerFeeBps) / BPS;
            usdt.safeTransferFrom(msg.sender, address(this), pulled);
            uint256 spent;
            (filled, spent) = _takeAsks(token, msg.sender, price, amount, type(uint256).max);
            uint256 keep;
            if (filled < amount) {
                keep = _ceilCost(price, amount - filled);
                id = _rest(token, true, price, amount - filled, keep);
            }
            uint256 refund = pulled - spent - keep;
            if (refund > 0) usdt.safeTransfer(msg.sender, refund);
        } else {
            ShareToken(token).lock(msg.sender, amount);
            uint256 proceeds;
            (filled, proceeds) = _takeBids(token, msg.sender, price, amount);
            if (proceeds > 0) usdt.safeTransfer(msg.sender, proceeds);
            if (filled < amount) id = _rest(token, false, price, amount - filled, 0);
        }
    }

    function cancel(uint64 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.maker != msg.sender) revert NotMaker();
        if (!o.active) revert Inactive();
        _remove(id);
        if (o.isBuy) {
            uint256 escrow = o.escrow;
            o.escrow = 0;
            if (escrow > 0) usdt.safeTransfer(o.maker, escrow);
        } else {
            ShareToken(o.token).unlock(o.maker, o.remaining);
        }
        emit OrderCancelled(id);
    }

    // ---------------------------------------------------------------- market orders

    /// @notice Spend up to `usdtIn` (fees included) on the cheapest asks. Unspent USDT is returned.
    function marketBuy(address token, uint256 usdtIn, uint256 minSharesOut)
        external
        nonReentrant
        returns (uint256 sharesOut, uint256 spent)
    {
        if (!hub.isShareToken(token)) revert UnknownToken();
        if (usdtIn == 0) revert ZeroAmount();
        usdt.safeTransferFrom(msg.sender, address(this), usdtIn);
        (sharesOut, spent) = _takeAsks(token, msg.sender, type(uint256).max, type(uint256).max, usdtIn);
        if (sharesOut < minSharesOut) revert Slippage();
        if (usdtIn > spent) usdt.safeTransfer(msg.sender, usdtIn - spent);
    }

    /// @notice Sell `sharesIn` into the best bids immediately; whatever cannot fill stays in your wallet.
    function marketSell(address token, uint256 sharesIn, uint256 minUsdtOut)
        external
        nonReentrant
        returns (uint256 sold, uint256 proceeds)
    {
        if (!hub.isShareToken(token)) revert UnknownToken();
        if (sharesIn == 0) revert ZeroAmount();
        ShareToken(token).lock(msg.sender, sharesIn);
        (sold, proceeds) = _takeBids(token, msg.sender, 0, sharesIn);
        if (sold < sharesIn) ShareToken(token).unlock(msg.sender, sharesIn - sold);
        if (proceeds < minUsdtOut) revert Slippage();
        if (proceeds > 0) usdt.safeTransfer(msg.sender, proceeds);
    }

    // ---------------------------------------------------------------- views

    /// @notice Up to `depth` resting orders per side, best first.
    function getBook(address token, uint256 depth)
        external
        view
        returns (uint256[] memory bidPx, uint256[] memory bidSz, uint256[] memory askPx, uint256[] memory askSz)
    {
        (bidPx, bidSz) = _side(bestBid[token], depth);
        (askPx, askSz) = _side(bestAsk[token], depth);
    }

    function quoteBuy(address token, uint256 usdtIn) external view returns (uint256 sharesOut) {
        uint64 cur = bestAsk[token];
        uint256 budget = usdtIn;
        for (uint256 n; cur != 0 && n < MAX_MATCHES; n++) {
            Order storage a = orders[cur];
            uint256 fill = _affordable(a.price, budget);
            if (fill > a.remaining) fill = a.remaining;
            if (fill == 0) break;
            uint256 cost = (a.price * fill) / 1e18;
            budget -= cost + (cost * takerFeeBps) / BPS;
            sharesOut += fill;
            cur = a.next;
        }
    }

    // ---------------------------------------------------------------- matching

    /// @dev Buyer's USDT is already in this contract. Stops at `limitPrice`, `maxShares` or `budget`.
    function _takeAsks(address token, address buyer, uint256 limitPrice, uint256 maxShares, uint256 budget)
        internal
        returns (uint256 filled, uint256 spent)
    {
        uint64 cur = bestAsk[token];
        for (uint256 n; cur != 0 && n < MAX_MATCHES && filled < maxShares; n++) {
            Order storage a = orders[cur];
            if (a.price > limitPrice) break;
            uint256 fill = a.remaining;
            if (maxShares - filled < fill) fill = maxShares - filled;
            if (budget != type(uint256).max) {
                uint256 canAfford = _affordable(a.price, budget - spent);
                if (canAfford < fill) fill = canAfford;
                if (fill == 0) break;
            }
            uint64 next = a.next;
            spent += _fillAsk(cur, buyer, fill);
            filled += fill;
            if (orders[cur].active) break; // maker only partially filled, so the taker is done
            cur = next;
        }
    }

    /// @dev Settles `fill` shares of resting ask `id` to `buyer`; returns USDT consumed (cost + taker fee).
    function _fillAsk(uint64 id, address buyer, uint256 fill) internal returns (uint256) {
        Order storage a = orders[id];
        uint256 cost = (a.price * fill) / 1e18;
        uint256 fee = (cost * takerFeeBps) / BPS;
        ShareToken(a.token).transferLocked(a.maker, buyer, fill);
        usdt.safeTransfer(a.maker, cost);
        if (fee > 0) usdt.safeTransfer(hub.treasury(), fee);
        lastPrice[a.token] = a.price;
        emit Trade(a.token, id, buyer, a.maker, a.price, fill, true);
        a.remaining -= fill;
        if (a.remaining == 0) {
            _remove(id);
            emit OrderFilled(id);
        }
        return cost + fee;
    }

    /// @dev Seller's shares are already locked. Returns net USDT owed to the seller (fees deducted).
    function _takeBids(address token, address seller, uint256 limitPrice, uint256 maxShares)
        internal
        returns (uint256 filled, uint256 proceeds)
    {
        uint64 cur = bestBid[token];
        for (uint256 n; cur != 0 && n < MAX_MATCHES && filled < maxShares; n++) {
            Order storage b = orders[cur];
            if (b.price < limitPrice) break;
            uint256 fill = b.remaining;
            if (maxShares - filled < fill) fill = maxShares - filled;
            uint64 next = b.next;
            proceeds += _fillBid(cur, seller, fill);
            filled += fill;
            if (orders[cur].active) break;
            cur = next;
        }
    }

    /// @dev Settles `fill` shares from `seller` into resting bid `id`; returns the seller's net USDT.
    function _fillBid(uint64 id, address seller, uint256 fill) internal returns (uint256) {
        Order storage b = orders[id];
        uint256 cost = (b.price * fill) / 1e18;
        uint256 fee = (cost * takerFeeBps) / BPS;
        ShareToken(b.token).transferLocked(seller, b.maker, fill);
        b.escrow -= cost;
        if (fee > 0) usdt.safeTransfer(hub.treasury(), fee);
        lastPrice[b.token] = b.price;
        emit Trade(b.token, id, b.maker, seller, b.price, fill, false);
        b.remaining -= fill;
        if (b.remaining == 0) {
            uint256 dust = b.escrow;
            b.escrow = 0;
            _remove(id);
            if (dust > 0) usdt.safeTransfer(b.maker, dust);
            emit OrderFilled(id);
        }
        return cost - fee;
    }

    // ---------------------------------------------------------------- book maintenance

    function _rest(address token, bool isBuy, uint256 price, uint256 amount, uint256 escrow)
        internal
        returns (uint64 id)
    {
        id = nextOrderId++;
        Order storage o = orders[id];
        o.maker = msg.sender;
        o.token = token;
        o.isBuy = isBuy;
        o.active = true;
        o.price = price;
        o.remaining = amount;
        o.escrow = escrow;

        uint64 head = isBuy ? bestBid[token] : bestAsk[token];
        if (head == 0 || _better(price, orders[head].price, isBuy)) {
            o.next = head;
            if (head != 0) orders[head].prev = id;
            if (isBuy) bestBid[token] = id;
            else bestAsk[token] = id;
        } else {
            uint64 cur = head;
            while (orders[cur].next != 0 && !_better(price, orders[orders[cur].next].price, isBuy)) {
                cur = orders[cur].next;
            }
            o.prev = cur;
            o.next = orders[cur].next;
            if (o.next != 0) orders[o.next].prev = id;
            orders[cur].next = id;
        }
        emit OrderPlaced(id, msg.sender, token, isBuy, price, amount);
    }

    function _remove(uint64 id) internal {
        Order storage o = orders[id];
        if (o.prev != 0) {
            orders[o.prev].next = o.next;
        } else if (o.isBuy) {
            bestBid[o.token] = o.next;
        } else {
            bestAsk[o.token] = o.next;
        }
        if (o.next != 0) orders[o.next].prev = o.prev;
        o.prev = 0;
        o.next = 0;
        o.active = false;
    }

    function _side(uint64 cur, uint256 depth) internal view returns (uint256[] memory px, uint256[] memory sz) {
        px = new uint256[](depth);
        sz = new uint256[](depth);
        uint256 n;
        for (; cur != 0 && n < depth; n++) {
            px[n] = orders[cur].price;
            sz[n] = orders[cur].remaining;
            cur = orders[cur].next;
        }
        assembly {
            mstore(px, n)
            mstore(sz, n)
        }
    }

    function _better(uint256 a, uint256 b, bool isBuy) internal pure returns (bool) {
        return isBuy ? a > b : a < b;
    }

    function _ceilCost(uint256 price, uint256 amount) internal pure returns (uint256) {
        uint256 x = price * amount;
        return x == 0 ? 0 : (x - 1) / 1e18 + 1;
    }

    /// @dev Shares purchasable at `price` with `budget`, fee included.
    function _affordable(uint256 price, uint256 budget) internal view returns (uint256) {
        uint256 maxCost = (budget * BPS) / (BPS + takerFeeBps);
        return (maxCost * 1e18) / price;
    }
}
