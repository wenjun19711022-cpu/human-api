// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {EscrowOffering} from "../src/EscrowOffering.sol";
import {SliceHub} from "../src/SliceHub.sol";
import {CommitmentVault} from "../src/CommitmentVault.sol";

contract EscrowOfferingTest is Base {
    function test_launchWiresEverything() public view {
        SliceHub.Asset memory a = hub.asset(assetId);
        assertEq(uint8(a.status), uint8(SliceHub.Status.Launched));
        assertEq(a.trustScore, 86);
        assertEq(a.router, address(0));
        assertEq(token.minter(), address(offering));
        assertEq(token.operator(), address(exchange));
        assertEq(vault.bond(), DIVIDEND);
        assertEq(vault.bondPeriods(), 1);
        assertEq(offering.numTicks(), 1);
        assertEq(offering.prices(0), PRICE);
        assertEq(usdt.balanceOf(address(hub)), 0, "hub never holds funds");
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
        assertEq(usdt.balanceOf(treasury), 2_000e6, "1% upfront fee");
        assertEq(vault.feeRemaining(), 4_000e6, "2% vests in the vault");
        assertEq(usdt.balanceOf(merchant) - merchantBefore, 194_000e6);
        assertEq(usdt.balanceOf(address(offering)), 100_000e6, "bob's money still escrowed");
    }

    function test_autoConfirmAfterWindow() public {
        _fundAndDeliver();
        vm.expectRevert(EscrowOffering.DeadlineNotReached.selector);
        offering.autoConfirm(bob);
        vm.warp(block.timestamp + CONFIRM);
        vm.prank(carol);
        offering.autoConfirm(bob);
        assertEq(token.balanceOf(bob), 100_000e18);
    }

    function test_oversubscribedFixedPriceIsProRata() public {
        vm.prank(alice);
        offering.bid(0, 300_000e6);
        vm.prank(bob);
        offering.bid(0, 150_000e6); // 1.5x oversubscribed: nobody is "too late"
        assertEq(offering.coverageBps(), 15_000);
        _closeRound(offering);

        (uint256 aShares, uint256 aCost) = offering.allocation(alice);
        (uint256 bShares, uint256 bCost) = offering.allocation(bob);
        assertEq(aCost, 200_000e6);
        assertEq(bCost, 100_000e6);
        assertEq(aShares + bShares, FOR_SALE);

        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        offering.withdrawUnfilled(); // unfilled money comes back right after close, not after delivery
        assertEq(usdt.balanceOf(alice) - before, 100_000e6);
        vm.expectRevert(EscrowOffering.NothingToWithdraw.selector);
        vm.prank(alice);
        offering.withdrawUnfilled();

        _deliver(offering);
        before = usdt.balanceOf(bob);
        vm.prank(bob);
        offering.confirm(); // bob never withdrew: his remainder comes back on confirm
        assertEq(usdt.balanceOf(bob) - before, 50_000e6);
        assertEq(token.balanceOf(bob), 100_000e18);
    }

    function test_fractionalBids() public {
        vm.prank(carol);
        offering.bid(0, 10e6);
        vm.prank(carol);
        offering.bid(0, 0.5e6);
        (uint256 budget,,,,,) = offering.orders(carol);
        assertEq(budget, 10.5e6);
    }

    function test_cancelBeforeCutoffOnly() public {
        vm.prank(alice);
        offering.bid(0, 50_000e6);
        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        offering.cancel();
        assertEq(usdt.balanceOf(alice) - before, 50_000e6);
        assertEq(offering.totalBudget(), 0);

        vm.prank(bob);
        offering.bid(0, 50_000e6);
        vm.warp(offering.subscribeDeadline() - 2 days);
        vm.expectRevert(EscrowOffering.CancelWindowClosed.selector);
        vm.prank(bob);
        offering.cancel();
    }

    function test_cannotCloseBeforeDeadline() public {
        vm.prank(alice);
        offering.bid(0, 400_000e6);
        vm.expectRevert(EscrowOffering.RoundOpen.selector);
        offering.close();
    }

    function test_minRaiseMissed_everyoneRefunded() public {
        vm.prank(alice);
        offering.bid(0, 100_000e6);
        _closeRound(offering);
        assertEq(uint8(offering.phase()), uint8(EscrowOffering.Phase.Failed));
        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        offering.refund();
        assertEq(usdt.balanceOf(alice) - before, 100_000e6);

        uint256 m = usdt.balanceOf(merchant);
        vm.prank(merchant);
        vault.withdrawBond();
        assertEq(usdt.balanceOf(merchant) - m, DIVIDEND);
    }

    function test_settleDeadlineCountsFromSubscriptionDeadline() public {
        vm.prank(alice);
        offering.bid(0, 300_000e6);
        vm.warp(offering.subscribeDeadline() + 20 days); // nobody called close() for 20 days
        offering.close();
        assertEq(offering.settleDeadline(), offering.subscribeDeadline() + SETTLE);
    }

    function test_merchantMissesSettlement_refunds() public {
        vm.prank(alice);
        offering.bid(0, 300_000e6);
        _closeRound(offering);
        vm.prank(merchant);
        offering.signAgreement(keccak256("agreement"));
        vm.warp(offering.settleDeadline() + 1);
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
        offering.bid(0, 300_000e6);
        _closeRound(offering);
        vm.expectRevert(EscrowOffering.AgreementMissing.selector);
        vm.prank(verifier);
        offering.attestRegistration(keccak256("proof"));
        vm.prank(merchant);
        offering.signAgreement(keccak256("agreement"));
        vm.expectRevert(EscrowOffering.NotVerifier.selector);
        vm.prank(merchant);
        offering.attestRegistration(keccak256("self-attest"));
    }

    function test_disputeCostsABond_refundReturnsIt() public {
        _fundAndDeliver();
        uint256 before = usdt.balanceOf(bob);
        vm.prank(bob);
        usdt.approve(address(offering), type(uint256).max);
        vm.prank(bob);
        offering.dispute(keccak256("registry shows no transfer"));
        assertEq(before - usdt.balanceOf(bob), 2_000e6, "2% bond");

        vm.warp(block.timestamp + CONFIRM);
        vm.expectRevert(EscrowOffering.NoActiveOrder.selector);
        offering.autoConfirm(bob);

        vm.prank(arbitrator);
        offering.resolveDispute(bob, true);
        assertEq(usdt.balanceOf(bob), before + 100_000e6, "order + bond back");
        assertEq(token.balanceOf(bob), 0);
    }

    function test_frivolousDisputeLosesBondToMerchant() public {
        _fundAndDeliver();
        vm.prank(bob);
        offering.dispute(keccak256("changed my mind"));
        uint256 m = usdt.balanceOf(merchant);
        vm.prank(arbitrator);
        offering.resolveDispute(bob, false);
        assertEq(token.balanceOf(bob), 100_000e18);
        assertEq(usdt.balanceOf(merchant) - m, 97_000e6 + 2_000e6, "release + bond");
    }

    function test_arbitrationTimeout_investorRefundsThemselves() public {
        _fundAndDeliver();
        uint256 before = usdt.balanceOf(bob);
        vm.prank(bob);
        offering.dispute(keccak256("no answer from platform"));
        vm.warp(block.timestamp + offering.ARBITRATION_WINDOW());
        vm.expectRevert(EscrowOffering.DeadlineNotReached.selector);
        vm.prank(bob);
        offering.claimArbitrationTimeout();
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        offering.claimArbitrationTimeout();
        assertEq(usdt.balanceOf(bob), before + 100_000e6);
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
        hub.recordAudit(id, 90, bytes32(0), true);
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

    function test_bondIsPricedFromTrustScore() public {
        vm.prank(merchant);
        uint256 id = hub.submitAsset("ipfs://b-grade", bytes32(0));
        vm.prank(verifier);
        hub.recordAudit(id, 78, bytes32(0), true); // B → two periods
        assertEq(hub.requiredBondPeriods(id), 2);
        SliceHub.LaunchParams memory p = _params();
        vm.expectRevert(abi.encodeWithSelector(SliceHub.BondTooSmall.selector, 2 * DIVIDEND));
        vm.prank(merchant);
        hub.launch(id, p);
        p.bond = 2 * DIVIDEND;
        vm.prank(merchant);
        (,, address v,) = hub.launch(id, p);
        assertEq(CommitmentVault(v).bondPeriods(), 2);
    }

    function test_defaultsRaiseTheMerchantsFutureBond() public {
        _fundDeliverConfirm();
        vm.warp(firstDue + GRACE + 1);
        vault.slash(0);
        assertEq(hub.merchantDefaults(merchant), 1);

        vm.prank(merchant);
        uint256 id = hub.submitAsset("ipfs://second-bar", bytes32(0));
        vm.prank(verifier);
        hub.recordAudit(id, 90, bytes32(0), true);
        assertEq(hub.requiredBondPeriods(id), 2, "A grade, but one default on record");
    }
}
