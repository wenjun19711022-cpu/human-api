// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICompliance} from "./interfaces/ISliceHub.sol";

/// @title ShareToken
/// @notice One token per listed asset. The total supply represents `companyBps` of the underlying business
///         (e.g. 3000 = the 30% the merchant sold). Holders accrue USDT dividends pro rata; dividends follow
///         the balance through transfers (magnified-dividend-per-share accounting), so selling never strands
///         earned payouts.
/// @dev Deployed as a minimal clone by SliceHub. The exchange is the only `operator`: it can lock a holder's
///      tokens behind a resting sell order (they stay in the holder's balance and keep earning dividends)
///      and move locked tokens when the order fills.
contract ShareToken is Initializable, ReentrancyGuard, IERC20 {
    using SafeERC20 for IERC20;

    uint256 internal constant MAGNITUDE = 2 ** 128;

    struct InitParams {
        string name;
        string symbol;
        uint256 assetId;
        uint256 companyBps;
        address usdt;
        address minter;
        address operator;
        address compliance;
    }

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public assetId;
    uint256 public companyBps;
    IERC20 public usdt;
    address public minter;
    address public operator;
    address public compliance;

    /// @notice Tokens committed to resting sell orders on the exchange.
    mapping(address => uint256) public lockedOf;

    uint256 public magnifiedDividendPerShare;
    mapping(address => int256) internal magnifiedDividendCorrections;
    mapping(address => uint256) public withdrawnDividends;
    uint256 public totalDistributed;

    event DividendsDistributed(address indexed from, uint256 amount);
    event DividendClaimed(address indexed holder, uint256 amount);
    event Locked(address indexed holder, uint256 amount);
    event Unlocked(address indexed holder, uint256 amount);

    error NotMinter();
    error NotOperator();
    error NoHolders();
    error InsufficientFreeBalance();
    error InsufficientAllowance();
    error TransferBlocked();
    error ZeroAddress();

    constructor() {
        _disableInitializers();
    }

    function initialize(InitParams calldata p) external initializer {
        if (p.usdt == address(0) || p.minter == address(0)) revert ZeroAddress();
        name = p.name;
        symbol = p.symbol;
        assetId = p.assetId;
        companyBps = p.companyBps;
        usdt = IERC20(p.usdt);
        minter = p.minter;
        operator = p.operator;
        compliance = p.compliance;
    }

    // ---------------------------------------------------------------- ERC20

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Balance not committed to resting sell orders.
    function freeBalanceOf(address account) public view returns (uint256) {
        return balanceOf[account] - lockedOf[account];
    }

    // ---------------------------------------------------------------- issuance & exchange hooks

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        _checkCompliance(address(0), to, amount);
        totalSupply += amount;
        balanceOf[to] += amount;
        magnifiedDividendCorrections[to] -= int256(magnifiedDividendPerShare * amount);
        emit Transfer(address(0), to, amount);
    }

    function lock(address holder, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        if (freeBalanceOf(holder) < amount) revert InsufficientFreeBalance();
        lockedOf[holder] += amount;
        emit Locked(holder, amount);
    }

    function unlock(address holder, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        lockedOf[holder] -= amount;
        emit Unlocked(holder, amount);
    }

    function transferLocked(address from, address to, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        lockedOf[from] -= amount;
        emit Unlocked(from, amount);
        _transfer(from, to, amount);
    }

    // ---------------------------------------------------------------- dividends

    /// @notice Pull `amount` USDT from the caller and split it across all current holders.
    ///         Called by the CommitmentVault for promised payouts, or by the merchant for bonus payouts.
    function distribute(uint256 amount) external nonReentrant {
        if (totalSupply == 0) revert NoHolders();
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        magnifiedDividendPerShare += (amount * MAGNITUDE) / totalSupply;
        totalDistributed += amount;
        emit DividendsDistributed(msg.sender, amount);
    }

    function accumulativeDividendOf(address holder) public view returns (uint256) {
        return uint256(int256(magnifiedDividendPerShare * balanceOf[holder]) + magnifiedDividendCorrections[holder])
            / MAGNITUDE;
    }

    function withdrawableDividendOf(address holder) public view returns (uint256) {
        return accumulativeDividendOf(holder) - withdrawnDividends[holder];
    }

    function claim() external returns (uint256) {
        return claimFor(msg.sender);
    }

    /// @notice Anyone may push a holder's dividends to them (lets a keeper auto-pay everyone).
    function claimFor(address holder) public nonReentrant returns (uint256 amount) {
        amount = withdrawableDividendOf(holder);
        if (amount == 0) return 0;
        withdrawnDividends[holder] += amount;
        usdt.safeTransfer(holder, amount);
        emit DividendClaimed(holder, amount);
    }

    // ---------------------------------------------------------------- internal

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] - lockedOf[from] < amount) revert InsufficientFreeBalance();
        _checkCompliance(from, to, amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        int256 correction = int256(magnifiedDividendPerShare * amount);
        magnifiedDividendCorrections[from] += correction;
        magnifiedDividendCorrections[to] -= correction;
        emit Transfer(from, to, amount);
    }

    function _checkCompliance(address from, address to, uint256 amount) internal view {
        if (compliance != address(0) && !ICompliance(compliance).canTransfer(from, to, amount)) {
            revert TransferBlocked();
        }
    }
}
