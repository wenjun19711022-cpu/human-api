// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {ShareExchange} from "../src/ShareExchange.sol";

contract ShareExchangeTest is Base {
    address t;

    function setUp() public override {
        super.setUp();
        _fundDeliverConfirm();
        t = address(token);
    }

    function test_restingAskKeepsEarningDividends() public {
        vm.prank(alice);
        exchange.placeLimit(t, false, 1.2e6, 100_000e18);
        assertEq(token.balanceOf(alice), 200_000e18, "tokens never leave the seller");

        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 6_000e6, 1);
        assertEq(token.withdrawableDividendOf(address(exchange)), 0);
    }

    function test_marketBuySweepsBestAsksFirst() public {
        vm.prank(alice);
        exchange.placeLimit(t, false, 1.3e6, 10_000e18);
        vm.prank(bob);
        exchange.placeLimit(t, false, 1.2e6, 10_000e18);

        uint256 aliceBefore = usdt.balanceOf(alice);
        uint256 bobBefore = usdt.balanceOf(bob);
        uint256 carolBefore = usdt.balanceOf(carol);
        vm.prank(carol);
        (uint256 got, uint256 spent) = exchange.marketBuy(t, 20_000e6, 0);

        // 10k @ 1.20 = 12,000 (+60 fee); remaining 7,940 budget buys 7940/1.005/1.3 ≈ 6,077 @ 1.30
        assertEq(usdt.balanceOf(bob) - bobBefore, 12_000e6, "cheapest ask filled first, maker pays no fee");
        assertGt(usdt.balanceOf(alice) - aliceBefore, 0);
        assertEq(carolBefore - usdt.balanceOf(carol), spent);
        assertLe(spent, 20_000e6);
        assertEq(token.balanceOf(carol), got);
        assertApproxEqAbs(got, 16_077e18, 1e18);
        assertEq(exchange.lastPrice(t), 1.3e6);
    }

    function test_limitBuyRestsThenFillsAgainstSeller() public {
        uint256 before = usdt.balanceOf(carol);
        vm.prank(carol);
        (uint64 id, uint256 filled) = exchange.placeLimit(t, true, 0.9e6, 5_000e18);
        assertEq(filled, 0);
        assertEq(before - usdt.balanceOf(carol), 4_500e6, "maker escrows cost only, no fee");

        uint256 aliceBefore = usdt.balanceOf(alice);
        vm.prank(alice);
        (uint256 sold, uint256 proceeds) = exchange.marketSell(t, 8_000e18, 0);
        assertEq(sold, 5_000e18);
        assertEq(proceeds, 4_500e6 - 22.5e6, "taker pays 0.5%");
        assertEq(usdt.balanceOf(alice) - aliceBefore, proceeds);
        assertEq(token.balanceOf(carol), 5_000e18);
        assertEq(token.lockedOf(alice), 0, "unfilled part unlocked");
        (,,, bool active,,,,,) = exchange.orders(id);
        assertFalse(active);
    }

    function test_crossingLimitFillsAtMakerPrice() public {
        vm.prank(alice);
        exchange.placeLimit(t, false, 1e6, 1_000e18);
        uint256 before = usdt.balanceOf(carol);
        vm.prank(carol);
        (uint64 id, uint256 filled) = exchange.placeLimit(t, true, 1.5e6, 1_000e18);
        assertEq(filled, 1_000e18);
        assertEq(id, 0, "fully filled, nothing rests");
        assertEq(before - usdt.balanceOf(carol), 1_005e6, "paid maker price + fee, refunded the rest");
    }

    function test_priceTimePriority() public {
        vm.prank(alice);
        exchange.placeLimit(t, true, 1e6, 100e18);
        vm.prank(bob);
        exchange.placeLimit(t, true, 1.1e6, 100e18);
        vm.prank(carol);
        exchange.placeLimit(t, true, 1e6, 100e18);

        (uint256[] memory bp, uint256[] memory bs,,) = exchange.getBook(t, 10);
        assertEq(bp.length, 3);
        assertEq(bp[0], 1.1e6);
        assertEq(bp[1], 1e6);
        assertEq(bs[2], 100e18);

        vm.prank(alice);
        exchange.marketSell(t, 150e18, 0);
        assertEq(token.balanceOf(bob), 100_000e18 + 100e18, "best price first");
        // alice's own bid (earlier time at 1.00) fills before carol's
        (uint256[] memory bp2, uint256[] memory bs2,,) = exchange.getBook(t, 10);
        assertEq(bp2.length, 2);
        assertEq(bs2[0], 50e18);
    }

    function test_cancelReturnsEscrowAndUnlocks() public {
        vm.prank(carol);
        (uint64 bid,) = exchange.placeLimit(t, true, 0.5e6, 1_000e18);
        vm.prank(alice);
        (uint64 ask,) = exchange.placeLimit(t, false, 2e6, 1_000e18);

        vm.expectRevert(ShareExchange.NotMaker.selector);
        vm.prank(bob);
        exchange.cancel(bid);

        uint256 before = usdt.balanceOf(carol);
        vm.prank(carol);
        exchange.cancel(bid);
        assertEq(usdt.balanceOf(carol) - before, 500e6);

        vm.prank(alice);
        exchange.cancel(ask);
        assertEq(token.lockedOf(alice), 0);
    }

    function test_reinvestBuysMoreWithDividends() public {
        vm.prank(alice);
        exchange.placeLimit(t, false, 1e6, 10_000e18);
        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);
        uint256 usdtBefore = usdt.balanceOf(bob);
        vm.prank(bob);
        (uint256 got, uint256 spent) = exchange.reinvest(t, 0);
        assertApproxEqAbs(spent, 3_000e6, 3, "bob's whole dividend went back in");
        assertApproxEqAbs(got, 2_985e18, 1e18, "minus the 0.5% taker fee");
        assertEq(token.balanceOf(bob), 100_000e18 + got);
        assertApproxEqAbs(usdt.balanceOf(bob), usdtBefore, 3, "wallet unchanged: claim and buy in one step");
        assertEq(token.withdrawableDividendOf(bob), 0);
    }

    function test_slippageGuard() public {
        vm.prank(alice);
        exchange.placeLimit(t, false, 2e6, 100e18);
        vm.expectRevert(ShareExchange.Slippage.selector);
        vm.prank(carol);
        exchange.marketBuy(t, 100e6, 60e18);
    }

    function test_unknownTokenRejected() public {
        vm.expectRevert(ShareExchange.UnknownToken.selector);
        exchange.placeLimit(address(usdt), true, 1e6, 1e18);
    }

    function testFuzz_exchangeNeverLeaksUsdt(uint64 p1, uint64 p2, uint64 budget) public {
        p1 = uint64(bound(p1, 0.01e6, 10e6));
        p2 = uint64(bound(p2, 0.01e6, 10e6));
        budget = uint64(bound(budget, 1e6, 50_000e6));
        vm.prank(alice);
        exchange.placeLimit(t, false, p1, 1_000e18);
        vm.prank(bob);
        exchange.placeLimit(t, true, p2, 1_000e18);
        vm.prank(carol);
        exchange.marketBuy(t, budget, 0);
        (uint256[] memory bp,,,) = exchange.getBook(t, 5);
        uint256 restingEscrow;
        for (uint64 i = 1; i < exchange.nextOrderId(); i++) {
            (,,, bool active,,,,, uint256 escrow) = exchange.orders(i);
            if (active) restingEscrow += escrow;
        }
        assertEq(usdt.balanceOf(address(exchange)), restingEscrow, "exchange holds exactly the resting bid escrow");
        assertLe(bp.length, 1);
    }
}
