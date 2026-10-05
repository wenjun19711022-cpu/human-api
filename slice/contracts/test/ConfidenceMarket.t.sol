// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {ConfidenceMarket} from "../src/ConfidenceMarket.sol";

contract ConfidenceMarketTest is Base {
    uint256 id;

    function setUp() public override {
        super.setUp();
        _fundDeliverConfirm();
        id = confidence.createMarket(address(vault), 0);
    }

    function test_pricesFollowMoney() public {
        assertEq(confidence.yesPriceBps(id), 5000);
        vm.prank(alice);
        confidence.bet(id, true, 3_000e6);
        vm.prank(carol);
        confidence.bet(id, false, 1_000e6);
        assertEq(confidence.yesPriceBps(id), 7500, "75% implied chance of paying on time");
    }

    function test_merchantCannotBet() public {
        vm.expectRevert(ConfidenceMarket.InsiderBet.selector);
        vm.prank(merchant);
        confidence.bet(id, false, 1_000e6);
    }

    function test_resolvesYesWhenPaidOnTime() public {
        vm.prank(alice);
        confidence.bet(id, true, 1_000e6);
        vm.prank(carol);
        confidence.bet(id, false, 500e6);

        vm.warp(firstDue);
        vm.expectRevert(ConfidenceMarket.MarketClosed.selector);
        vm.prank(bob);
        confidence.bet(id, true, 1e6);

        vm.prank(merchant);
        vault.pay(0);
        confidence.resolve(id);

        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        confidence.claim(id);
        // 1000 stake + 500 losing pool - 2% fee on the losing pool
        assertEq(usdt.balanceOf(alice) - before, 1_490e6);
        assertEq(usdt.balanceOf(treasury), 3_000e6 + 1_500e6 + 10e6, "upfront fee + on-time fee slice + market fee");

        vm.prank(carol);
        assertEq(confidence.claim(id), 0);
        vm.expectRevert(ConfidenceMarket.AlreadyClaimed.selector);
        vm.prank(alice);
        confidence.claim(id);
    }

    function test_resolvesNoOnDefault_holdersHedged() public {
        // Bob holds shares and hedges by buying NO.
        vm.prank(bob);
        confidence.bet(id, false, 2_000e6);
        vm.prank(carol);
        confidence.bet(id, true, 2_000e6);

        vm.expectRevert(ConfidenceMarket.NotResolvable.selector);
        confidence.resolve(id);

        vm.warp(firstDue + GRACE + 1);
        confidence.resolve(id); // resolvable even before anyone slashes
        uint256 before = usdt.balanceOf(bob);
        vm.prank(bob);
        confidence.claim(id);
        assertEq(usdt.balanceOf(bob) - before, 3_960e6);
    }

    function test_emptyWinningSideRefunds() public {
        vm.prank(carol);
        confidence.bet(id, false, 700e6);
        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);
        confidence.resolve(id);
        uint256 before = usdt.balanceOf(carol);
        vm.prank(carol);
        confidence.claim(id);
        assertEq(usdt.balanceOf(carol) - before, 700e6);
    }

    function test_duplicateAndUnknownMarkets() public {
        vm.expectRevert(ConfidenceMarket.MarketExists.selector);
        confidence.createMarket(address(vault), 0);
        vm.expectRevert(ConfidenceMarket.UnknownVault.selector);
        confidence.createMarket(address(0xBEEF), 0);
        vm.expectRevert(ConfidenceMarket.BadPeriod.selector);
        confidence.createMarket(address(vault), 9);
    }
}
