// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only view of the hub that per-asset contracts rely on for roles and wiring.
interface ISliceHub {
    function usdt() external view returns (address);
    function treasury() external view returns (address);
    function exchange() external view returns (address);
    function isVerifier(address account) external view returns (bool);
    function isArbitrator(address account) external view returns (bool);
    function isShareToken(address token) external view returns (bool);
    function isVault(address vault) external view returns (bool);
}

/// @notice Optional transfer gate (KYC allow-list, jurisdiction rules). address(0) = open transfers.
interface ICompliance {
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);
}
