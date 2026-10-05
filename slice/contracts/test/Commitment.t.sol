// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {CommitmentVault} from "../src/CommitmentVault.sol";
import {ShareToken} from "../src/ShareToken.sol";

contract CommitmentTest is Base {
    function setUp() public override {
        super.setUp();
        _fundDeliverConfirm();
    }

    function test_onTimePaymentSplitsProRata_andReleasesAFeeSlice() public {
        assertEq(vault.feeRemaining(), 6_000e6, "2% of 300k vests here");
        uint256 t0 = usdt.balanceOf(treasury);
        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 6_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(bob), 3_000e6, 1);
        assertEq(usdt.balanceOf(treasury) - t0, 1_500e6, "one of four fee slices, earned by paying on time");
        (bool resolved, bool honored) = vault.isResolved(0);
        assertTrue(resolved && honored);

        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        token.claim();
        assertApproxEqAbs(usdt.balanceOf(alice) - before, 6_000e6, 1);
    }

    function test_installmentsFillTheEarliestPeriod() public {
        vm.startPrank(merchant);
        vault.contribute(4_000e6); // a bar paying from the till as the quarter goes
        assertEq(vault.periodCredit(0), 4_000e6);
        assertEq(uint8(vault.periodStatus(0)), uint8(CommitmentVault.PeriodStatus.Pending));
        assertEq(vault.shortfall(0), 5_000e6);
        vault.contribute(6_000e6);
        vm.stopPrank();
        assertEq(uint8(vault.periodStatus(0)), uint8(CommitmentVault.PeriodStatus.Paid), "prepaid before due = on time");
        assertEq(vault.periodCredit(1), 1_000e6);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), uint256(10_000e6) * 2 / 3, 2, "holders were paid immediately");
        assertEq(vault.nextPendingPeriod(), 1);
    }

    function test_slashTakesOnlyTheShortfall() public {
        vm.prank(merchant);
        vault.contribute(5_000e6);
        vm.warp(firstDue + GRACE + 1);
        vm.prank(carol); // anyone can enforce
        vault.slash(0);
        assertEq(vault.bond(), 5_000e6, "bond covered the missing 4,000 only");
        assertEq(vault.periodPaidAmount(0), 9_000e6);
        assertEq(vault.defaults(), 1);
        // holders: 5,000 contributed + 4,000 slashed + 1,500 fee slice forfeited by the platform
        assertApproxEqAbs(token.withdrawableDividendOf(alice) + token.withdrawableDividendOf(bob), 10_500e6, 2);
    }

    function test_lateOrMissedPeriodsCostThePlatformItsFee() public {
        uint256 t0 = usdt.balanceOf(treasury);
        vm.warp(firstDue + GRACE + 1);
        vm.prank(merchant);
        vault.pay(0); // late
        assertEq(uint8(vault.periodStatus(0)), uint8(CommitmentVault.PeriodStatus.PaidLate));
        assertEq(usdt.balanceOf(treasury), t0, "no fee for a late period");
        assertApproxEqAbs(token.withdrawableDividendOf(alice) + token.withdrawableDividendOf(bob), 10_500e6, 2);
        (bool resolved, bool honored) = vault.isResolved(0);
        assertTrue(resolved);
        assertFalse(honored);
    }

    function test_cannotPayASettledPeriodTwice() public {
        vm.warp(firstDue + GRACE + 1);
        vault.slash(0);
        vm.expectRevert(CommitmentVault.NotPending.selector);
        vm.prank(merchant);
        vault.pay(0);
        vm.expectRevert(CommitmentVault.NotYetDefaulted.selector);
        vault.slash(1);
    }

    function test_dividendsFollowTransfers() public {
        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);
        vm.prank(alice);
        token.transfer(carol, 100_000e18);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 6_000e6, 1, "earned dividend stays with seller");
        assertEq(token.withdrawableDividendOf(carol), 0);
        vm.warp(vault.dueDate(1));
        vm.prank(merchant);
        vault.pay(1);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 9_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(carol), 3_000e6, 1);
    }

    function test_raiseCommitmentNeedsBond() public {
        vm.expectRevert(CommitmentVault.BondTooSmall.selector);
        vm.prank(merchant);
        vault.raiseCommitment(12_000e6);
        vm.prank(merchant);
        vault.postBond(3_000e6);
        vm.prank(merchant);
        vault.raiseCommitment(12_000e6);
        assertEq(vault.amountPerPeriod(), 12_000e6);
        vm.expectRevert(CommitmentVault.NotHigher.selector);
        vm.prank(merchant);
        vault.raiseCommitment(11_000e6);
    }

    function test_bondAndFeesSettleWhenEveryPeriodIsDone() public {
        vm.expectRevert(CommitmentVault.StillActive.selector);
        vm.prank(merchant);
        vault.withdrawBond();
        uint256 t0 = usdt.balanceOf(treasury);
        for (uint256 i; i < 4; i++) {
            vm.warp(vault.dueDate(i));
            vm.prank(merchant);
            vault.pay(i);
        }
        assertEq(vault.paidOnTime(), 4);
        assertEq(vault.feeRemaining(), 0);
        assertEq(usdt.balanceOf(treasury) - t0, 6_000e6, "full vested fee only because every period was on time");
        uint256 before = usdt.balanceOf(merchant);
        vm.prank(merchant);
        vault.withdrawBond();
        assertEq(usdt.balanceOf(merchant) - before, DIVIDEND);
    }

    function test_merchantCanPayBonusDividendDirectly() public {
        vm.startPrank(merchant);
        usdt.approve(address(token), 3_000e6);
        token.distribute(3_000e6);
        vm.stopPrank();
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 2_000e6, 1);
        assertEq(vault.periodCredit(0), 0, "a direct bonus does not count toward the promise");
    }

    function testFuzz_installmentsNeverLoseMoney(uint64[5] memory parts) public {
        uint256 total;
        vm.startPrank(merchant);
        for (uint256 i; i < 5; i++) {
            uint256 amt = bound(parts[i], 1e6, 15_000e6);
            vault.contribute(amt);
            total += amt;
        }
        vm.stopPrank();
        uint256 credited;
        for (uint256 i; i < 4; i++) credited += vault.periodCredit(i);
        assertEq(credited, total > 4 * DIVIDEND ? 4 * DIVIDEND : total, "credit = contributions, capped at the promise");
        uint256 owed = token.withdrawableDividendOf(alice) + token.withdrawableDividendOf(bob);
        assertLe(owed, vault.totalPaid(), "never owes more than was paid in");
        assertApproxEqAbs(owed, vault.totalPaid(), 3);
    }

    function test_freeBalanceGuardsLockedShares() public {
        vm.prank(alice);
        exchange.placeLimit(address(token), false, 2e6, 150_000e18);
        assertEq(token.lockedOf(alice), 150_000e18);
        vm.expectRevert(ShareToken.InsufficientFreeBalance.selector);
        vm.prank(alice);
        token.transfer(carol, 60_000e18);
        vm.prank(alice);
        token.transfer(carol, 50_000e18);
    }
}
