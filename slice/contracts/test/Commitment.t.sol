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

    function test_onTimePaymentSplitsProRata() public {
        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 6_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(bob), 3_000e6, 1);
        assertEq(uint8(vault.periodStatus(0)), uint8(CommitmentVault.PeriodStatus.Paid));
        (bool resolved, bool honored) = vault.isResolved(0);
        assertTrue(resolved && honored);

        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        token.claim();
        assertApproxEqAbs(usdt.balanceOf(alice) - before, 6_000e6, 1);
        assertEq(token.withdrawableDividendOf(alice), 0);
    }

    function test_dividendsFollowTransfers() public {
        vm.warp(firstDue);
        vm.prank(merchant);
        vault.pay(0);

        vm.prank(alice);
        token.transfer(carol, 100_000e18); // alice sells half after the payout
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 6_000e6, 1, "earned dividend stays with seller");
        assertEq(token.withdrawableDividendOf(carol), 0);

        vm.warp(vault.dueDate(1));
        vm.prank(merchant);
        vault.pay(1);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 9_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(carol), 3_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(bob), 6_000e6, 1);
    }

    function test_latePaymentRecordedAsLate() public {
        vm.warp(firstDue + GRACE + 1);
        vm.prank(merchant);
        vault.pay(0);
        assertEq(uint8(vault.periodStatus(0)), uint8(CommitmentVault.PeriodStatus.PaidLate));
        (bool resolved, bool honored) = vault.isResolved(0);
        assertTrue(resolved);
        assertFalse(honored);
    }

    function test_slashPaysHoldersFromBond() public {
        vm.warp(firstDue + GRACE);
        vm.expectRevert(CommitmentVault.NotYetDefaulted.selector);
        vault.slash(0);

        vm.warp(firstDue + GRACE + 1);
        vm.prank(carol); // anyone can enforce
        vault.slash(0);
        assertEq(vault.bond(), 0);
        assertEq(vault.defaults(), 1);
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 6_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(bob), 3_000e6, 1);

        vm.expectRevert(CommitmentVault.NotPending.selector);
        vm.prank(merchant);
        vault.pay(0);
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
        assertEq(vault.annualizedCommitment(), (12_000e6 * 365 days) / QUARTER);

        vm.expectRevert(CommitmentVault.NotHigher.selector);
        vm.prank(merchant);
        vault.raiseCommitment(11_000e6);
    }

    function test_bondLockedUntilAllPeriodsSettled() public {
        vm.expectRevert(CommitmentVault.StillActive.selector);
        vm.prank(merchant);
        vault.withdrawBond();

        for (uint256 i; i < 4; i++) {
            vm.warp(vault.dueDate(i));
            vm.prank(merchant);
            vault.pay(i);
        }
        assertEq(vault.paidOnTime(), 4);
        assertEq(vault.nextPendingPeriod(), 4);
        uint256 before = usdt.balanceOf(merchant);
        vm.prank(merchant);
        vault.withdrawBond();
        assertEq(usdt.balanceOf(merchant) - before, DIVIDEND);
    }

    function test_merchantCanPayBonusDividend() public {
        vm.startPrank(merchant);
        usdt.approve(address(token), 3_000e6);
        token.distribute(3_000e6);
        vm.stopPrank();
        assertApproxEqAbs(token.withdrawableDividendOf(alice), 2_000e6, 1);
        assertApproxEqAbs(token.withdrawableDividendOf(bob), 1_000e6, 1);
    }

    function testFuzz_dividendConservation(uint96 a, uint96 b, uint96 amount) public {
        a = uint96(bound(a, 1, 200_000e18));
        b = uint96(bound(b, 1, 100_000e18));
        amount = uint96(bound(amount, 1e6, 1_000_000e6));
        vm.prank(alice);
        token.transfer(carol, a);
        vm.prank(bob);
        token.transfer(carol, b);
        vm.startPrank(merchant);
        usdt.approve(address(token), amount);
        token.distribute(amount);
        vm.stopPrank();
        uint256 owed = token.withdrawableDividendOf(alice) + token.withdrawableDividendOf(bob)
            + token.withdrawableDividendOf(carol);
        assertLe(owed, amount, "never owes more than was distributed");
        assertApproxEqAbs(owed, amount, 3, "rounding dust only");
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
