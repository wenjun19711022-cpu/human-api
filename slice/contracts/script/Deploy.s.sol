// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {SliceHub} from "../src/SliceHub.sol";
import {ShareToken} from "../src/ShareToken.sol";
import {EscrowOffering} from "../src/EscrowOffering.sol";
import {CommitmentVault} from "../src/CommitmentVault.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {ConfidenceMarket} from "../src/ConfidenceMarket.sol";
import {ShareExchange} from "../src/ShareExchange.sol";

/// @notice Deploys the protocol. On a testnet, leave USDT unset to deploy MockUSDT with a faucet.
///
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
///
/// Env (all optional):
///   USDT        existing USDT address (mainnet / L2). Omit on testnets.
///   TREASURY    fee receiver (defaults to deployer)
///   VERIFIER    AI due-diligence agent signer (defaults to deployer)
///   ARBITRATOR  dispute resolver (defaults to deployer)
///   SEED_DEMO   "true" to submit, audit and launch a demo asset (local anvil only)
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address usdtAddr = vm.envOr("USDT", address(0));
        address treasury = vm.envOr("TREASURY", deployer);
        address verifier = vm.envOr("VERIFIER", deployer);
        address arbitrator = vm.envOr("ARBITRATOR", deployer);
        bool seed = vm.envOr("SEED_DEMO", false);

        vm.startBroadcast();
        if (usdtAddr == address(0)) usdtAddr = address(new MockUSDT());
        SliceHub hub = new SliceHub(
            usdtAddr,
            treasury,
            address(new ShareToken()),
            address(new EscrowOffering()),
            address(new CommitmentVault()),
            address(new RevenueRouter())
        );
        ShareExchange exchange = new ShareExchange(address(hub), 50); // 0.5% taker fee
        ConfidenceMarket confidence = new ConfidenceMarket(address(hub), 200); // 2% of the losing pool
        hub.setExchange(address(exchange));
        hub.setVerifier(verifier, true);
        hub.setArbitrator(arbitrator, true);

        if (seed) _seed(hub, MockUSDT(usdtAddr), deployer);
        vm.stopBroadcast();

        console2.log("USDT              ", usdtAddr);
        console2.log("SliceHub          ", address(hub));
        console2.log("ShareExchange     ", address(exchange));
        console2.log("ConfidenceMarket  ", address(confidence));
    }

    function _seed(SliceHub hub, MockUSDT usdt, address merchant) internal {
        usdt.mint(merchant, 1_000_000e6);
        uint256 id = hub.submitAsset("ipfs://slice-demo/neon-coyote-bar.json", keccak256("demo-docs"));
        hub.recordAudit(id, 86, keccak256("demo-ai-report"), true);
        usdt.approve(address(hub), 9_000e6);
        (address token, address offering, address vault,) = hub.launch(
            id,
            SliceHub.LaunchParams({
                name: "Neon Coyote Bar 30%",
                symbol: "NCB",
                companyBps: 3000,
                floorPrice: 1e6,
                tickBps: 500, // a 6-step price ladder, +5% per step: investors name their price
                numTicks: 6,
                sharesForSale: 300_000e18,
                minRaise: 240_000e6,
                subscribeDuration: 14 days,
                settleWindow: 30 days,
                confirmWindow: 7 days,
                termsHash: keccak256("demo-terms"),
                dividendPerPeriod: 9_000e6,
                periodLength: 90 days,
                firstDue: uint64(block.timestamp + 14 days + 30 days + 7 days + 90 days),
                numPeriods: 4,
                grace: 7 days,
                bond: 9_000e6,
                routerHolderBps: 0
            })
        );
        console2.log("demo ShareToken   ", token);
        console2.log("demo Offering     ", offering);
        console2.log("demo Vault        ", vault);
    }
}
