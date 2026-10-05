// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CommitmentVault} from "./CommitmentVault.sol";

/// @title RevenueRouter
/// @notice 收入直连: the payee address a distributor, app store or payment processor pays into, instead of the
///         merchant's bank account. Whoever calls `flush()` splits the balance: `holderBps` goes through the
///         CommitmentVault (counts toward the promise, reaches holders at once), the rest goes to the merchant.
///         The split is fixed at launch and has no admin, so trust comes from where the money lands first, not
///         from the merchant's honesty.
/// @dev Revenue sent before any investor holds shares stays here until the first flush after delivery.
contract RevenueRouter is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;

    IERC20 public usdt;
    CommitmentVault public vault;
    address public merchant;
    uint16 public holderBps;
    uint256 public totalRouted;
    uint256 public totalToHolders;

    event Flushed(address indexed by, uint256 total, uint256 toHolders, uint256 toMerchant);

    error NothingToFlush();

    constructor() {
        _disableInitializers();
    }

    function initialize(address usdt_, address vault_, address merchant_, uint16 holderBps_) external initializer {
        usdt = IERC20(usdt_);
        vault = CommitmentVault(vault_);
        merchant = merchant_;
        holderBps = holderBps_;
    }

    function flush() external nonReentrant returns (uint256 toHolders, uint256 toMerchant) {
        uint256 balance = usdt.balanceOf(address(this));
        if (balance == 0) revert NothingToFlush();
        toHolders = (balance * holderBps) / BPS;
        toMerchant = balance - toHolders;
        if (toHolders > 0) {
            usdt.forceApprove(address(vault), toHolders);
            vault.contribute(toHolders);
        }
        if (toMerchant > 0) usdt.safeTransfer(merchant, toMerchant);
        totalRouted += balance;
        totalToHolders += toHolders;
        emit Flushed(msg.sender, balance, toHolders, toMerchant);
    }
}
