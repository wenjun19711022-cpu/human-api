// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ShareToken} from "./ShareToken.sol";
import {EscrowOffering} from "./EscrowOffering.sol";
import {CommitmentVault} from "./CommitmentVault.sol";
import {RevenueRouter} from "./RevenueRouter.sol";

/// @title SliceHub
/// @notice Front door for every business that wants to go on-chain.
///   1. submitAsset   — merchant files documents (hashes on-chain, files off-chain)
///   2. recordAudit   — the AI due-diligence agent / human verifier posts a trust score and pass/fail
///   3. launch        — merchant sets terms and posts the dividend bond; the hub clones a ShareToken, an
///                      EscrowOffering, a CommitmentVault and (for revenue shares) a RevenueRouter in one call
///
/// The AI score has teeth: the bond a merchant must post is priced from it. A-grade businesses bond one period of
/// dividends, B two, C three, below that four, plus one extra period for every default the merchant has on record
/// anywhere on Slice.
contract SliceHub is Ownable {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Submitted,
        Audited,
        Rejected,
        Launched,
        Frozen
    }

    struct Asset {
        address merchant;
        Status status;
        uint16 trustScore; // 0-100
        bytes32 docsRoot;
        bytes32 auditHash;
        string uri;
        address token;
        address offering;
        address vault;
        address router;
    }

    struct LaunchParams {
        string name;
        string symbol;
        uint256 companyBps; // share of the business (or of revenue) being sold, 3000 = 30%
        uint256 floorPrice; // USDT per 1e18 share units at the lowest tick
        uint16 tickBps; // auction price step; 0 with numTicks = 1 for a fixed price
        uint8 numTicks;
        uint256 sharesForSale;
        uint256 minRaise;
        uint64 subscribeDuration;
        uint64 settleWindow;
        uint64 confirmWindow;
        bytes32 termsHash;
        uint256 dividendPerPeriod;
        uint64 periodLength;
        uint64 firstDue;
        uint32 numPeriods;
        uint64 grace;
        uint256 bond;
        uint16 routerHolderBps; // 0 = no revenue router
    }

    uint256 internal constant MAX_FEE_BPS = 1_000;

    IERC20 public immutable usdt;
    address public immutable tokenImpl;
    address public immutable offeringImpl;
    address public immutable vaultImpl;
    address public immutable routerImpl;

    address public treasury;
    address public exchange;
    address public defaultCompliance;
    uint16 public upfrontFeeBps = 100;
    uint16 public vestedFeeBps = 200;
    uint8 public minBondPeriods = 1;

    mapping(address => bool) public isVerifier;
    mapping(address => bool) public isArbitrator;
    mapping(address => bool) public isShareToken;
    mapping(address => bool) public isVault;
    mapping(address => uint32) public merchantDefaults;

    Asset[] internal _assets;

    event AssetSubmitted(uint256 indexed id, address indexed merchant, string uri, bytes32 docsRoot);
    event DocsUpdated(uint256 indexed id, string uri, bytes32 docsRoot);
    event AuditRecorded(uint256 indexed id, address indexed verifier, uint16 score, bytes32 auditHash, bool approved);
    event AssetLaunched(uint256 indexed id, address token, address offering, address vault, address router);
    event AssetFrozen(uint256 indexed id, bool frozen);
    event DefaultRecorded(address indexed merchant, uint32 defaults);
    event RoleSet(bytes32 indexed role, address indexed account, bool enabled);
    event ConfigSet(bytes32 indexed key, address value, uint256 number);

    error NotMerchant();
    error NotVerifier();
    error NotVault();
    error BadStatus();
    error BadParams();
    error BondTooSmall(uint256 required);
    error ExchangeNotSet();

    constructor(address usdt_, address treasury_, address tokenImpl_, address offeringImpl_, address vaultImpl_, address routerImpl_)
        Ownable(msg.sender)
    {
        usdt = IERC20(usdt_);
        treasury = treasury_;
        tokenImpl = tokenImpl_;
        offeringImpl = offeringImpl_;
        vaultImpl = vaultImpl_;
        routerImpl = routerImpl_;
    }

    // ---------------------------------------------------------------- merchant flow

    function submitAsset(string calldata uri, bytes32 docsRoot) external returns (uint256 id) {
        id = _assets.length;
        Asset storage a = _assets.push();
        a.merchant = msg.sender;
        a.status = Status.Submitted;
        a.uri = uri;
        a.docsRoot = docsRoot;
        emit AssetSubmitted(id, msg.sender, uri, docsRoot);
    }

    /// @notice Merchant supplements documents (e.g. bank statements requested in public Q&A) before launch.
    function updateDocs(uint256 id, string calldata uri, bytes32 docsRoot) external {
        Asset storage a = _assets[id];
        if (a.merchant != msg.sender) revert NotMerchant();
        if (a.status == Status.Launched || a.status == Status.Frozen) revert BadStatus();
        a.uri = uri;
        a.docsRoot = docsRoot;
        emit DocsUpdated(id, uri, docsRoot);
    }

    function recordAudit(uint256 id, uint16 score, bytes32 auditHash, bool approved) external {
        if (!isVerifier[msg.sender]) revert NotVerifier();
        if (score > 100) revert BadParams();
        Asset storage a = _assets[id];
        if (a.status != Status.Submitted && a.status != Status.Audited && a.status != Status.Rejected) {
            revert BadStatus();
        }
        a.trustScore = score;
        a.auditHash = auditHash;
        a.status = approved ? Status.Audited : Status.Rejected;
        emit AuditRecorded(id, msg.sender, score, auditHash, approved);
    }

    function launch(uint256 id, LaunchParams calldata p)
        external
        returns (address token, address offering, address vault, address router)
    {
        Asset storage a = _assets[id];
        if (a.merchant != msg.sender) revert NotMerchant();
        if (a.status != Status.Audited) revert BadStatus();
        if (exchange == address(0)) revert ExchangeNotSet();
        _validate(p);
        uint256 periods = requiredBondPeriods(id);
        if (p.bond < p.dividendPerPeriod * periods) revert BondTooSmall(p.dividendPerPeriod * periods);

        token = Clones.clone(tokenImpl);
        offering = Clones.clone(offeringImpl);
        vault = Clones.clone(vaultImpl);
        if (p.routerHolderBps > 0) router = Clones.clone(routerImpl);

        _initToken(id, token, offering, p);
        _initOffering(token, offering, vault, p);
        _initVault(token, offering, vault, uint32(periods), p);
        if (router != address(0)) RevenueRouter(router).initialize(address(usdt), vault, msg.sender, p.routerHolderBps);

        // Bond goes straight from the merchant into the vault; the hub never keeps funds.
        usdt.safeTransferFrom(msg.sender, address(this), p.bond);
        usdt.forceApprove(vault, p.bond);
        CommitmentVault(vault).postBond(p.bond);

        a.token = token;
        a.offering = offering;
        a.vault = vault;
        a.router = router;
        a.status = Status.Launched;
        isShareToken[token] = true;
        isVault[vault] = true;
        emit AssetLaunched(id, token, offering, vault, router);
    }

    /// @notice Called by a vault when its merchant defaults.
    function recordDefault(address merchant) external {
        if (!isVault[msg.sender]) revert NotVault();
        uint32 n = ++merchantDefaults[merchant];
        emit DefaultRecorded(merchant, n);
    }

    // ---------------------------------------------------------------- views

    /// @notice Periods of dividends the merchant must bond: priced from the AI trust score and default history.
    function requiredBondPeriods(uint256 id) public view returns (uint256 periods) {
        Asset storage a = _assets[id];
        uint256 score = a.trustScore;
        periods = score >= 85 ? 1 : score >= 75 ? 2 : score >= 60 ? 3 : 4;
        periods += merchantDefaults[a.merchant];
        if (periods < minBondPeriods) periods = minBondPeriods;
    }

    function asset(uint256 id) external view returns (Asset memory) {
        return _assets[id];
    }

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    // ---------------------------------------------------------------- admin

    function setVerifier(address account, bool enabled) external onlyOwner {
        isVerifier[account] = enabled;
        emit RoleSet("verifier", account, enabled);
    }

    function setArbitrator(address account, bool enabled) external onlyOwner {
        isArbitrator[account] = enabled;
        emit RoleSet("arbitrator", account, enabled);
    }

    function setExchange(address exchange_) external onlyOwner {
        exchange = exchange_;
        emit ConfigSet("exchange", exchange_, 0);
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
        emit ConfigSet("treasury", treasury_, 0);
    }

    function setDefaultCompliance(address compliance) external onlyOwner {
        defaultCompliance = compliance;
        emit ConfigSet("compliance", compliance, 0);
    }

    function setFees(uint16 upfrontBps, uint16 vestedBps) external onlyOwner {
        if (uint256(upfrontBps) + vestedBps > MAX_FEE_BPS) revert BadParams();
        upfrontFeeBps = upfrontBps;
        vestedFeeBps = vestedBps;
        emit ConfigSet("fees", address(0), uint256(upfrontBps) << 16 | vestedBps);
    }

    function setMinBondPeriods(uint8 periods) external onlyOwner {
        minBondPeriods = periods;
        emit ConfigSet("minBondPeriods", address(0), periods);
    }

    /// @notice Flags an asset (fraud signal, court order). Does not touch escrowed funds.
    function setFrozen(uint256 id, bool frozen) external onlyOwner {
        Asset storage a = _assets[id];
        if (frozen) {
            a.status = Status.Frozen;
        } else {
            a.status = a.token == address(0) ? Status.Submitted : Status.Launched;
        }
        emit AssetFrozen(id, frozen);
    }

    // ---------------------------------------------------------------- internal

    function _initToken(uint256 id, address token, address offering, LaunchParams calldata p) internal {
        ShareToken(token).initialize(
            ShareToken.InitParams({
                name: p.name,
                symbol: p.symbol,
                assetId: id,
                companyBps: p.companyBps,
                usdt: address(usdt),
                minter: offering,
                operator: exchange,
                compliance: defaultCompliance
            })
        );
    }

    function _initOffering(address token, address offering, address vault, LaunchParams calldata p) internal {
        EscrowOffering(offering).initialize(
            EscrowOffering.InitParams({
                hub: address(this),
                token: token,
                vault: vault,
                merchant: msg.sender,
                floorPrice: p.floorPrice,
                tickBps: p.tickBps,
                numTicks: p.numTicks,
                sharesForSale: p.sharesForSale,
                minRaise: p.minRaise,
                subscribeDeadline: uint64(block.timestamp) + p.subscribeDuration,
                settleWindow: p.settleWindow,
                confirmWindow: p.confirmWindow,
                upfrontFeeBps: upfrontFeeBps,
                vestedFeeBps: vestedFeeBps,
                termsHash: p.termsHash
            })
        );
    }

    function _initVault(address token, address offering, address vault, uint32 bondPeriods, LaunchParams calldata p)
        internal
    {
        CommitmentVault(vault).initialize(
            CommitmentVault.InitParams({
                hub: address(this),
                token: token,
                offering: offering,
                merchant: msg.sender,
                amountPerPeriod: p.dividendPerPeriod,
                periodLength: p.periodLength,
                firstDue: p.firstDue,
                numPeriods: p.numPeriods,
                grace: p.grace,
                bondPeriods: bondPeriods
            })
        );
    }

    function _validate(LaunchParams calldata p) internal view {
        if (p.companyBps == 0 || p.companyBps > 10_000) revert BadParams();
        if (p.floorPrice == 0 || p.sharesForSale == 0) revert BadParams();
        if (p.numTicks == 0 || p.numTicks > 32 || (p.numTicks > 1 && p.tickBps == 0) || p.tickBps > 5_000) {
            revert BadParams();
        }
        if (p.subscribeDuration == 0 || p.settleWindow == 0 || p.periodLength == 0 || p.numPeriods == 0) {
            revert BadParams();
        }
        if (p.routerHolderBps > 10_000) revert BadParams();
        // Every investor holds their shares (auto-confirm done) before the first payout falls due.
        uint256 latestDelivery =
            block.timestamp + uint256(p.subscribeDuration) + uint256(p.settleWindow) + uint256(p.confirmWindow);
        if (p.firstDue < latestDelivery) revert BadParams();
    }
}
