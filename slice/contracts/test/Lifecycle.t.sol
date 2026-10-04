// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";

/// @notice The whole story in one test: a bar in Los Angeles sells 30% to strangers in Tokyo, Lagos and
///         São Paulo; they get paid every quarter; one of them sells on the open market; when the bar finally
///         misses a payment, its bond pays holders and the confidence market settles NO by itself.
contract LifecycleTest is Base {
    function test_fullStory() public {
        // 1. Round: escrowed USDT, merchant delivers, buyers confirm receipt.
        _fundAndDeliver();
        vm.prank(alice);
        offering.confirm();
        vm.warp(block.timestamp + CONFIRM);
        offering.autoConfirm(bob);
        assertEq(token.totalSupply(), FOR_SALE);

        // 2. Market makes a call on the first payout.
        uint256 q0 = confidence.createMarket(address(vault), 0);
        vm.prank(carol);
        confidence.bet(q0, true, 1_000e6);

        // 3. Quarter 1 paid on time.
        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);
        confidence.resolve(q0);
        vm.prank(carol);
        assertEq(confidence.claim(q0), 1_000e6, "only YES money in the pool: stake back");

        // 4. Alice sells 50k shares to Carol on the order book.
        vm.prank(alice);
        exchange.placeLimit(address(token), false, 1.25e6, 50_000e18);
        vm.prank(carol);
        exchange.marketBuy(address(token), 70_000e6, 0);
        assertEq(token.balanceOf(carol), 50_000e18);

        // 5. Quarter 2: the bar goes quiet. Bob hedges with NO.
        uint256 q1 = confidence.createMarket(address(vault), 1);
        vm.prank(bob);
        confidence.bet(q1, false, 500e6);
        vm.prank(carol);
        confidence.bet(q1, true, 500e6);

        vm.warp(vault.dueDate(1) + GRACE + 1);
        vault.slash(1);
        confidence.resolve(q1);
        vm.prank(bob);
        assertEq(confidence.claim(q1), 990e6);

        // Every holder still received both quarters: one paid, one from the slashed bond.
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 6_000e6 + 4_500e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(bob), 3_000e6 + 3_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(carol), 1_500e6, 1);
        assertEq(vault.defaults(), 1);
        assertEq(vault.paidOnTime(), 1);
    }
}
