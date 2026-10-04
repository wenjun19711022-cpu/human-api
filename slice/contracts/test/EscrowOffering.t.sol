// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {EscrowOffering} from "../src/EscrowOffering.sol";
import {SliceHub} from "../src/SliceHub.sol";

contract EscrowOfferingTest is Base {
    function test_launchWiresEverything() public view {
        SliceHub.Asset memory a = hub.asset(assetId);
        assertEq(uint8(a.status), uint8(SliceHub.Status.Launched));
        assertEq(a.trustScore, 86);
        assertEq(token.minter(), address(offering));
        assertEq(token.operator(), address(exchange));
        assertEq(vault.bond(), DIVIDEND);
        assertEq(usdt.balanceOf(address(hub)), 0, "hub never holds funds");
        assertTrue(hub.isShareToken(address(token)));
        assertTrue(hub.isVault(address(vault)));
    }

    function test_happyPath_confirmReceiptReleasesFunds() public {
        _fundAndDeliver();
        assertEq(uint8(offering.phase()), uint8(EscrowOffering.Phase.Delivered));
        assertEq(usdt.balanceOf(address(offering)), 300_000e6, "all money still in escrow");
        assertEq(token.totalSupply(), 0, "nothing minted before confirmation");

        uint256 merchantBefore = usdt.balanceOf(merchant);
        vm.prank(alice);
        offering.confirm();

        assertEq(token.balanceOf(alice), 200_000e18);
        assertEq(usdt.balanceOf(treasury), 6_000e6, "3% platform fee");
        assertEq(usdt.balanceOf(merchant) - merchantBefore, 194_000e6);
        assertEq(usdt.balanceOf(address(offering)), 100_000e6, "bob's money still escrowed");
    }

    function test_autoConfirmAfterWindow() public {
        _fundAndDeliver();
        vm.expectRevert(EscrowOffering.DeadlineNotReached.selector);
        offering.autoConfirm(bob);

        vm.warp(block.timestamp + CONFIRM);
        vm.prank(carol); // any keeper
        offering.autoConfirm(bob);
        assertEq(token.balanceOf(bob), 100_000e18);
    }

    function test_oversubscriptionIsCapped() public {
        vm.prank(alice);
        offering.subscribe(250_000e6);
        uint256 before = usdt.balanceOf(bob);
        vm.prank(bob);
        uint256 shares = offering.subscribe(100_000e6);
        assertEq(shares, 50_000e18);
        assertEq(before - usdt.balanceOf(bob), 50_000e6, "only the capped cost is pulled");
        vm.expectRevert(EscrowOffering.SoldOut.selector);
        vm.prank(carol);
        offering.subscribe(1e6);
    }

    function test_fractionalSubscription() public {
        vm.prank(carol);
        uint256 shares = offering.subscribe(10e6); // $10 ticket
        assertEq(shares, 10e18);
        vm.prank(carol);
        shares = offering.subscribe(0.5e6);
        assertEq(shares, 0.5e18);
    }

    function test_cancelDuringRoundRefunds() public {
        vm.prank(alice);
        offering.subscribe(50_000e6);
        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        offering.cancel();
        assertEq(usdt.balanceOf(alice) - before, 50_000e6);
        assertEq(offering.totalRaised(), 0);
        assertEq(offering.investorCount(), 0);
    }

    function test_cannotCloseEarlyUnlessSoldOut() public {
        vm.prank(alice);
        offering.subscribe(250_000e6);
        vm.expectRevert(EscrowOffering.RoundOpen.selector);
        offering.close();
    }

    function test_minRaiseMissed_everyoneRefunded() public {
        vm.prank(alice);
        offering.subscribe(100_000e6);
        vm.warp(block.timestamp + SUB);
        offering.close();
        assertEq(uint8(offering.phase()), uint8(EscrowOffering.Phase.Failed));

        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        offering.refund();
        assertEq(usdt.balanceOf(alice) - before, 100_000e6);

        vm.expectRevert(EscrowOffering.NoActiveOrder.selector);
        vm.prank(alice);
        offering.refund();

        // Merchant gets the bond back because the round never delivered.
        uint256 m = usdt.balanceOf(merchant);
        vm.prank(merchant);
        vault.withdrawBond();
        assertEq(usdt.balanceOf(merchant) - m, DIVIDEND);
    }

    function test_merchantMissesSettlement_refunds() public {
        vm.prank(alice);
        offering.subscribe(300_000e6);
        offering.close();
        vm.prank(merchant);
        offering.signAgreement(keccak256("agreement"));

        vm.warp(block.timestamp + SETTLE + 1);
        vm.expectRevert(EscrowOffering.DeadlinePassed.selector);
        vm.prank(verifier);
        offering.attestRegistration(keccak256("late"));

        offering.failSettlement();
        vm.prank(alice);
        offering.refund();
        assertEq(usdt.balanceOf(address(offering)), 0);
    }

    function test_onlyVerifierAttests_andAgreementRequired() public {
        vm.prank(alice);
        offering.subscribe(300_000e6);
        offering.close();

        vm.expectRevert(EscrowOffering.AgreementMissing.selector);
        vm.prank(verifier);
        offering.attestRegistration(keccak256("proof"));

        vm.prank(merchant);
        offering.signAgreement(keccak256("agreement"));

        vm.expectRevert(EscrowOffering.NotVerifier.selector);
        vm.prank(merchant);
        offering.attestRegistration(keccak256("self-attest"));
    }

    function test_disputeRefundedByArbitrator() public {
        _fundAndDeliver();
        vm.prank(bob);
        offering.dispute(keccak256("registry shows no transfer"));

        vm.warp(block.timestamp + CONFIRM);
        vm.expectRevert(EscrowOffering.NoActiveOrder.selector);
        offering.autoConfirm(bob);

        uint256 before = usdt.balanceOf(bob);
        vm.prank(arbitrator);
        offering.resolveDispute(bob, true);
        assertEq(usdt.balanceOf(bob) - before, 100_000e6);
        assertEq(token.balanceOf(bob), 0);
    }

    function test_disputeRejectedReleases() public {
        _fundAndDeliver();
        vm.prank(bob);
        offering.dispute(keccak256("changed my mind"));
        vm.prank(arbitrator);
        offering.resolveDispute(bob, false);
        assertEq(token.balanceOf(bob), 100_000e18);
    }

    function test_cannotDisputeAfterWindow() public {
        _fundAndDeliver();
        vm.warp(block.timestamp + CONFIRM);
        vm.expectRevert(EscrowOffering.ConfirmWindowClosed.selector);
        vm.prank(bob);
        offering.dispute(bytes32(0));
    }

    function test_launchRejectsFirstDueBeforeDelivery() public {
        vm.prank(merchant);
        uint256 id = hub.submitAsset("ipfs://x", bytes32(0));
        vm.prank(verifier);
        hub.recordAudit(id, 70, bytes32(0), true);
        SliceHub.LaunchParams memory p = _params();
        p.firstDue = uint64(block.timestamp + 1 days);
        vm.expectRevert(SliceHub.BadParams.selector);
        vm.prank(merchant);
        hub.launch(id, p);
    }

    function test_rejectedAssetCannotLaunch() public {
        vm.prank(merchant);
        uint256 id = hub.submitAsset("ipfs://shady", bytes32(0));
        vm.prank(verifier);
        hub.recordAudit(id, 22, bytes32(0), false);
        SliceHub.LaunchParams memory p = _params();
        vm.expectRevert(SliceHub.BadStatus.selector);
        vm.prank(merchant);
        hub.launch(id, p);
    }
}
