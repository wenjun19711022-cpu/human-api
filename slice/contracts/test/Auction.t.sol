// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {SliceHub} from "../src/SliceHub.sol";
import {ShareToken} from "../src/ShareToken.sol";
import {EscrowOffering} from "../src/EscrowOffering.sol";

/// @notice Uniform-price batch auction: a ladder of 5 prices, +10% per tick: 1.00, 1.10, 1.21, 1.331, 1.4641.
contract AuctionTest is Base {
    EscrowOffering auction;
    ShareToken auctionToken;
    uint256 constant SUPPLY = 100_000e18;

    function setUp() public override {
        super.setUp();
        SliceHub.LaunchParams memory p = _params();
        p.symbol = "AUC";
        p.tickBps = 1_000;
        p.numTicks = 5;
        p.sharesForSale = SUPPLY;
        p.minRaise = 50_000e6;
        (, auctionToken, auction,,) = _list(90, p);
    }

    function test_ladder() public view {
        assertEq(auction.prices(0), 1_000_000);
        assertEq(auction.prices(1), 1_100_000);
        assertEq(auction.prices(4), 1_464_100);
    }

    function test_everyoneAboveTheClearingTickPaysTheSamePrice() public {
        vm.prank(alice);
        auction.bid(4, 50_000e6); // willing to pay $1.4641
        vm.prank(bob);
        auction.bid(2, 50_000e6); // $1.21
        vm.prank(carol);
        auction.bid(1, 40_000e6); // $1.10 — marginal
        _closeRound(auction);

        assertEq(auction.clearingPrice(), 1_100_000, "clears at $1.10");
        assertEq(auction.clearingTick(), 1);
        (uint256 aShares, uint256 aCost) = auction.allocation(alice);
        (uint256 bShares, uint256 bCost) = auction.allocation(bob);
        (uint256 cShares, uint256 cCost) = auction.allocation(carol);
        assertEq(aCost, 50_000e6);
        assertEq(bCost, 50_000e6);
        assertEq(aShares, bShares, "same price for alice and bob");
        assertApproxEqAbs(cCost, 10_000e6, 1, "carol shares what's left");
        assertLe(aShares + bShares + cShares, SUPPLY);
        assertApproxEqRel(aShares + bShares + cShares, SUPPLY, 1e12);
        assertEq(auction.totalRaised(), aCost + bCost + 10_000e6);
    }

    function test_priceRisesBetweenTicksWhenTopBiddersCoverSupply() public {
        vm.prank(alice);
        auction.bid(4, 140_000e6);
        vm.prank(bob);
        auction.bid(3, 10_000e6);
        _closeRound(auction);
        assertEq(auction.clearingPrice(), 1_400_000, "$1.40: alice alone exactly covers supply");
        (uint256 aShares, uint256 aCost) = auction.allocation(alice);
        (uint256 bShares,) = auction.allocation(bob);
        assertEq(aCost, 140_000e6);
        assertEq(aShares, SUPPLY);
        assertEq(bShares, 0, "bob's limit is below the clearing price");
        uint256 before = usdt.balanceOf(bob);
        vm.prank(bob);
        auction.withdrawUnfilled();
        assertEq(usdt.balanceOf(bob) - before, 10_000e6);
    }

    function test_undersubscribedFillsEveryoneAtTheFloor() public {
        vm.prank(alice);
        auction.bid(4, 40_000e6);
        vm.prank(bob);
        auction.bid(0, 20_000e6);
        _closeRound(auction);
        assertTrue(auction.filledAtFloor());
        assertEq(auction.clearingPrice(), 1_000_000, "everybody pays the floor");
        (uint256 aShares,) = auction.allocation(alice);
        assertEq(aShares, 40_000e18);
        assertEq(auction.totalRaised(), 60_000e6);
    }

    function test_previewMatchesClose() public {
        vm.prank(alice);
        auction.bid(3, 70_000e6);
        vm.prank(bob);
        auction.bid(1, 60_000e6);
        (uint8 tick, uint256 price,,, uint256 raised) = auction.previewClearing();
        _closeRound(auction);
        assertEq(auction.clearingTick(), tick);
        assertEq(auction.clearingPrice(), price);
        assertEq(auction.totalRaised(), raised);
    }

    function test_tickRules() public {
        vm.expectRevert(EscrowOffering.BadTick.selector);
        vm.prank(alice);
        auction.bid(5, 1e6);
        vm.prank(alice);
        auction.bid(2, 1e6);
        vm.expectRevert(EscrowOffering.TickMismatch.selector);
        vm.prank(alice);
        auction.bid(3, 1e6);
    }

    /// @dev Whatever the bids: shares never exceed supply, USDT never leaks, everyone gets budget − cost back.
    function testFuzz_auctionConservation(uint8[4] memory ticks, uint64[4] memory amounts) public {
        address[4] memory who = [alice, bob, carol, distributor];
        vm.prank(distributor);
        usdt.approve(address(auction), type(uint256).max);
        uint256 total;
        for (uint256 i; i < 4; i++) {
            uint256 amt = bound(amounts[i], 1e6, 200_000e6);
            vm.prank(who[i]);
            auction.bid(uint8(bound(ticks[i], 0, 4)), amt);
            total += amt;
        }
        _closeRound(auction);
        if (auction.phase() == EscrowOffering.Phase.Failed) {
            for (uint256 i; i < 4; i++) {
                vm.prank(who[i]);
                auction.refund();
            }
            assertEq(usdt.balanceOf(address(auction)), 0);
            return;
        }
        uint256 shares;
        uint256 cost;
        for (uint256 i; i < 4; i++) {
            (uint256 s, uint256 c) = auction.allocation(who[i]);
            (uint256 budget,,,,,) = auction.orders(who[i]);
            assertLe(c, budget);
            shares += s;
            cost += c;
        }
        assertLe(shares, SUPPLY, "never oversold");
        assertLe(cost, auction.totalRaised());
        assertLe(auction.totalRaised() - cost, 4, "rounding dust only");

        _deliver(auction);
        for (uint256 i; i < 4; i++) {
            vm.prank(who[i]);
            auction.confirm();
        }
        assertEq(usdt.balanceOf(address(auction)), 0, "every dollar went to the merchant side or back to bidders");
        assertEq(auctionToken.totalSupply(), shares);
        assertGt(total, 0);
    }
}
