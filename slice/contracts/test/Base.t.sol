// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {SliceHub} from "../src/SliceHub.sol";
import {ShareToken} from "../src/ShareToken.sol";
import {EscrowOffering} from "../src/EscrowOffering.sol";
import {CommitmentVault} from "../src/CommitmentVault.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {ConfidenceMarket} from "../src/ConfidenceMarket.sol";
import {ShareExchange} from "../src/ShareExchange.sol";

/// @dev Deploys the full protocol and launches one asset: 30% of a Los Angeles bar, 300,000 shares at a fixed
///      $1, promising $9,000 per quarter to holders, bonded with one quarter (AI score 86 → grade A → 1 period).
abstract contract Base is Test {
    MockUSDT usdt;
    SliceHub hub;
    ShareExchange exchange;
    ConfidenceMarket confidence;

    ShareToken token;
    EscrowOffering offering;
    CommitmentVault vault;
    uint256 assetId;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address verifier = makeAddr("aiVerifier");
    address arbitrator = makeAddr("arbitrator");
    address merchant = makeAddr("merchant");
    address alice = makeAddr("alice"); // Tokyo
    address bob = makeAddr("bob"); // Lagos
    address carol = makeAddr("carol"); // São Paulo
    address distributor = makeAddr("distributor"); // pays royalties into a RevenueRouter

    uint256 constant PRICE = 1e6; // $1 per share
    uint256 constant FOR_SALE = 300_000e18;
    uint256 constant MIN_RAISE = 240_000e6;
    uint256 constant DIVIDEND = 9_000e6; // per quarter
    uint64 constant QUARTER = 90 days;
    uint64 constant GRACE = 7 days;
    uint64 constant SUB = 14 days;
    uint64 constant SETTLE = 30 days;
    uint64 constant CONFIRM = 7 days;

    uint64 firstDue;

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        vm.startPrank(platform);
        usdt = new MockUSDT();
        hub = new SliceHub(
            address(usdt),
            treasury,
            address(new ShareToken()),
            address(new EscrowOffering()),
            address(new CommitmentVault()),
            address(new RevenueRouter())
        );
        exchange = new ShareExchange(address(hub), 50);
        confidence = new ConfidenceMarket(address(hub), 200);
        hub.setExchange(address(exchange));
        hub.setVerifier(verifier, true);
        hub.setArbitrator(arbitrator, true);
        vm.stopPrank();

        address[5] memory people = [merchant, alice, bob, carol, distributor];
        for (uint256 i; i < people.length; i++) {
            usdt.mint(people[i], 1_000_000e6);
            vm.startPrank(people[i]);
            usdt.approve(address(hub), type(uint256).max);
            usdt.approve(address(exchange), type(uint256).max);
            usdt.approve(address(confidence), type(uint256).max);
            vm.stopPrank();
        }

        firstDue = uint64(block.timestamp) + SUB + SETTLE + CONFIRM + QUARTER;
        (assetId, token, offering, vault,) = _list(86, _params());
    }

    /// @dev Submit, audit with `score`, launch with `p`, and approve the new contracts for everyone.
    function _list(uint16 score, SliceHub.LaunchParams memory p)
        internal
        returns (uint256 id, ShareToken t, EscrowOffering o, CommitmentVault v, RevenueRouter r)
    {
        vm.prank(merchant);
        id = hub.submitAsset("ipfs://neon-coyote-bar", keccak256("docs-bundle-v1"));
        vm.prank(verifier);
        hub.recordAudit(id, score, keccak256("ai-report"), true);
        vm.prank(merchant);
        (address ta, address oa, address va, address ra) = hub.launch(id, p);
        (t, o, v, r) = (ShareToken(ta), EscrowOffering(oa), CommitmentVault(va), RevenueRouter(ra));
        address[5] memory all = [merchant, alice, bob, carol, distributor];
        for (uint256 i; i < all.length; i++) {
            vm.startPrank(all[i]);
            usdt.approve(oa, type(uint256).max);
            usdt.approve(va, type(uint256).max);
            vm.stopPrank();
        }
    }

    function _params() internal view returns (SliceHub.LaunchParams memory) {
        return SliceHub.LaunchParams({
            name: "Neon Coyote Bar 30%",
            symbol: "NCB",
            companyBps: 3000,
            floorPrice: PRICE,
            tickBps: 0,
            numTicks: 1,
            sharesForSale: FOR_SALE,
            minRaise: MIN_RAISE,
            subscribeDuration: SUB,
            settleWindow: SETTLE,
            confirmWindow: CONFIRM,
            termsHash: keccak256("terms-v1"),
            dividendPerPeriod: DIVIDEND,
            periodLength: QUARTER,
            firstDue: firstDue,
            numPeriods: 4,
            grace: GRACE,
            bond: DIVIDEND,
            routerHolderBps: 0
        });
    }

    function _closeRound(EscrowOffering o) internal {
        vm.warp(o.subscribeDeadline());
        o.close();
    }

    function _deliver(EscrowOffering o) internal {
        vm.prank(merchant);
        o.signAgreement(keccak256("signed-transfer-agreement.pdf"));
        vm.prank(verifier);
        o.attestRegistration(keccak256("ca-sos-statement-of-information"));
    }

    /// @dev alice 200k + bob 100k at the fixed price, round closes, merchant signs, verifier attests.
    function _fundAndDeliver() internal {
        vm.prank(alice);
        offering.bid(0, 200_000e6);
        vm.prank(bob);
        offering.bid(0, 100_000e6);
        _closeRound(offering);
        _deliver(offering);
    }

    function _fundDeliverConfirm() internal {
        _fundAndDeliver();
        vm.prank(alice);
        offering.confirm();
        vm.prank(bob);
        offering.confirm();
    }
}
