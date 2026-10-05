// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {SliceHub} from "../src/SliceHub.sol";
import {ShareToken} from "../src/ShareToken.sol";
import {EscrowOffering} from "../src/EscrowOffering.sol";
import {CommitmentVault} from "../src/CommitmentVault.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";

/// @notice A song's royalties: the distributor pays the router, never the artist. 50% goes to holders and
///         counts toward a $4,000/month promise; the artist keeps the other 50%.
contract RevenueRouterTest is Base {
    ShareToken songToken;
    EscrowOffering songRound;
    CommitmentVault songVault;
    RevenueRouter router;

    function setUp() public override {
        super.setUp();
        SliceHub.LaunchParams memory p = _params();
        p.symbol = "RAIN";
        p.companyBps = 5_000;
        p.sharesForSale = 120_000e18;
        p.minRaise = 60_000e6;
        p.dividendPerPeriod = 4_000e6;
        p.periodLength = 30 days;
        p.firstDue = uint64(block.timestamp) + SUB + SETTLE + CONFIRM + 30 days;
        p.numPeriods = 12;
        p.bond = 4_000e6;
        p.routerHolderBps = 5_000;
        (, songToken, songRound, songVault, router) = _list(91, p);

        vm.prank(alice);
        songRound.bid(0, 120_000e6);
        _closeRound(songRound);
    }

    function test_routerIsWiredAndHasNoAdmin() public view {
        assertEq(address(router.vault()), address(songVault));
        assertEq(router.merchant(), merchant);
        assertEq(router.holderBps(), 5_000);
    }

    function test_revenueBeforeDeliveryWaitsInTheRouter() public {
        vm.prank(distributor);
        usdt.transfer(address(router), 10_000e6);
        vm.expectRevert(CommitmentVault.OfferingNotDelivered.selector);
        router.flush();
        assertEq(usdt.balanceOf(address(router)), 10_000e6);
    }

    function test_flushPaysHoldersFirstAndHonoursThePromise() public {
        _deliver(songRound);
        vm.prank(alice);
        songRound.confirm();

        vm.prank(distributor);
        usdt.transfer(address(router), 10_000e6); // one month of royalties
        uint256 m = usdt.balanceOf(merchant);
        vm.prank(carol); // any keeper
        router.flush();

        assertEq(usdt.balanceOf(merchant) - m, 5_000e6, "artist keeps half");
        assertEq(uint8(songVault.periodStatus(0)), uint8(CommitmentVault.PeriodStatus.Paid), "promise met from the source");
        assertEq(songVault.periodCredit(1), 1_000e6, "the extra 1,000 starts next month");
        assertApproxEqAbs(songToken.withdrawableDividendOf(alice), 5_000e6, 2);
        assertEq(router.totalToHolders(), 5_000e6);
    }

    function test_emptyFlushReverts() public {
        vm.expectRevert(RevenueRouter.NothingToFlush.selector);
        router.flush();
    }
}
