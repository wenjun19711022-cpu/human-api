// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ShareToken} from "./ShareToken.sol";
import {EscrowOffering} from "./EscrowOffering.sol";
import {CommitmentVault} from "./CommitmentVault.sol";

/// @title SliceHub
/// @notice Front door for every business that wants to go on-chain.
///   1. submitAsset   — merchant files documents (hashes on-chain, files off-chain)
///   2. recordAudit   — the AI due-diligence agent / human verifier posts a trust score and pass/fail
///   3. launch        — merchant sets terms and posts the dividend bond; the hub clones a ShareToken,
///                      an EscrowOffering and a CommitmentVault for the asset in one transaction
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
        bytes32 docsRoot; // merkle root / hash of the submitted document bundle
        bytes32 auditHash; // hash of the full AI audit report
        string uri; // off-chain metadata (IPFS / HTTPS)
        address token;
        address offering;
        address vault;
    }

    struct LaunchParams {
        string name;
        string symbol;
        uint256 companyBps; // share of the business being sold, e.g. 3000 = 30%
        uint256 pricePerShare; // USDT per 1e18 share units
        uint256 sharesForSale;
        uint256 minRaise;
        uint64 subscribeDuration;
        uint64 settleWindow;
        uint64 confirmWindow;
        bytes32 termsHash;
        uint256 dividendPerPeriod; // promised USDT per period to all holders combined
        uint64 periodLength;
        uint64 firstDue;
        uint32 numPeriods;
        uint64 grace;
        uint256 bond; // posted now; must cover at least `minBondPeriods` periods
    }

    uint256 internal constant MAX_FEE_BPS = 1_000;

    IERC20 public immutable usdt;
    address public immutable tokenImpl;
    address public immutable offeringImpl;
    address public immutable vaultImpl;

    address public treasury;
    address public exchange;
    address public defaultCompliance;
    uint16 public raiseFeeBps = 300;
    uint8 public minBondPeriods = 1;

    mapping(address => bool) public isVerifier;
    mapping(address => bool) public isArbitrator;
    mapping(address => bool) public isShareToken;
    mapping(address => bool) public isVault;

    Asset[] internal _assets;

    event AssetSubmitted(uint256 indexed id, address indexed merchant, string uri, bytes32 docsRoot);
    event DocsUpdated(uint256 indexed id, string uri, bytes32 docsRoot);
    event AuditRecorded(uint256 indexed id, address indexed verifier, uint16 score, bytes32 auditHash, bool approved);
    event AssetLaunched(uint256 indexed id, address token, address offering, address vault);
    event AssetFrozen(uint256 indexed id, bool frozen);
    event RoleSet(bytes32 indexed role, address indexed account, bool enabled);
    event ConfigSet(bytes32 indexed key, address value, uint256 number);

    error NotMerchant();
    error NotVerifier();
    error BadStatus();
    error BadParams();
    error ExchangeNotSet();

    constructor(address usdt_, address treasury_, address tokenImpl_, address offeringImpl_, address vaultImpl_)
        Ownable(msg.sender)
    {
        usdt = IERC20(usdt_);
        treasury = treasury_;
        tokenImpl = tokenImpl_;
        offeringImpl = offeringImpl_;
        vaultImpl = vaultImpl_;
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
        returns (address token, address offering, address vault)
    {
        Asset storage a = _assets[id];
        if (a.merchant != msg.sender) revert NotMerchant();
        if (a.status != Status.Audited) revert BadStatus();
        if (exchange == address(0)) revert ExchangeNotSet();
        _validate(p);

        token = Clones.clone(tokenImpl);
        offering = Clones.clone(offeringImpl);
        vault = Clones.clone(vaultImpl);

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
        EscrowOffering(offering).initialize(
            EscrowOffering.InitParams({
                hub: address(this),
                token: token,
                merchant: msg.sender,
                pricePerShare: p.pricePerShare,
                sharesForSale: p.sharesForSale,
                minRaise: p.minRaise,
                subscribeDeadline: uint64(block.timestamp) + p.subscribeDuration,
                settleWindow: p.settleWindow,
                confirmWindow: p.confirmWindow,
                feeBps: raiseFeeBps,
                termsHash: p.termsHash
            })
        );
        CommitmentVault(vault).initialize(
            CommitmentVault.InitParams({
                token: token,
                offering: offering,
                merchant: msg.sender,
                usdt: address(usdt),
                amountPerPeriod: p.dividendPerPeriod,
                periodLength: p.periodLength,
                firstDue: p.firstDue,
                numPeriods: p.numPeriods,
                grace: p.grace
            })
        );

        // Bond goes straight from the merchant into the vault; the hub never holds funds.
        usdt.safeTransferFrom(msg.sender, address(this), p.bond);
        usdt.forceApprove(vault, p.bond);
        CommitmentVault(vault).postBond(p.bond);

        a.token = token;
        a.offering = offering;
        a.vault = vault;
        a.status = Status.Launched;
        isShareToken[token] = true;
        isVault[vault] = true;
        emit AssetLaunched(id, token, offering, vault);
    }

    // ---------------------------------------------------------------- views

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

    function setRaiseFee(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert BadParams();
        raiseFeeBps = bps;
        emit ConfigSet("raiseFee", address(0), bps);
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

    function _validate(LaunchParams calldata p) internal view {
        if (p.companyBps == 0 || p.companyBps > 10_000) revert BadParams();
        if (p.pricePerShare == 0 || p.sharesForSale == 0) revert BadParams();
        if (p.subscribeDuration == 0 || p.settleWindow == 0 || p.periodLength == 0 || p.numPeriods == 0) {
            revert BadParams();
        }
        // Every investor must hold their tokens (auto-confirm done) before the first payout falls due.
        uint256 latestDelivery =
            block.timestamp + uint256(p.subscribeDuration) + uint256(p.settleWindow) + uint256(p.confirmWindow);
        if (p.firstDue < latestDelivery) revert BadParams();
        if (p.bond < p.dividendPerPeriod * minBondPeriods) revert BadParams();
    }
}
