// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDT
/// @notice Testnet stand-in for USDT (6 decimals) with a rate-limited public faucet.
contract MockUSDT is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    mapping(address => uint256) public lastDrip;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Tether USD (Slice testnet)", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can drip 10,000 test USDT once per hour.
    function faucet() external {
        uint256 next = lastDrip[msg.sender] + FAUCET_COOLDOWN;
        if (lastDrip[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Unrestricted mint for local scripts and tests. Never deploy this contract to mainnet.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
