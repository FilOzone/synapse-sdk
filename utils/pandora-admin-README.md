# Pandora Admin Portal

A single-page web application for administering the Pandora storage provider contract on Filecoin.

## Features

- **Public View**: Browse all approved storage providers
- **Storage Provider Dashboard**: Register as a provider and check approval status
- **Owner Dashboard**: Approve/reject pending providers and manage approved providers
- **Real-time Updates**: Transaction monitoring and automatic UI updates
- **Wallet Support**: Connect via MetaMask or private key

## Prerequisites

1. Build the Synapse SDK browser bundle:
   ```bash
   npm run build:browser
   ```

2. Ensure you have access to Filecoin Calibration testnet

## Usage

1. Open `pandora-admin.html` in a web browser
2. Click "Connect Wallet" to authenticate:
   - **MetaMask**: Use browser extension (recommended)
   - **Private Key**: Enter key directly (for testing)

3. Navigate between sections:
   - **Public View**: Available without authentication
   - **Provider Dashboard**: Requires wallet connection
   - **Owner Dashboard**: Only accessible to contract owner

## User Roles

### General Public
- View list of approved storage providers
- See provider details (URLs, addresses)

### Storage Providers
- Register with PDP and retrieval URLs
- Check registration status (pending/approved)
- View provider details once approved

### Contract Owner
- View pending provider registrations
- Approve or reject pending providers
- Remove approved providers

## Technical Details

- **Network**: Filecoin Calibration testnet
- **Contract**: Pandora service contract
- **Dependencies**: ethers.js v6, Synapse SDK
- **Authentication**: EIP-712 typed signatures

## Development

The portal demonstrates Synapse SDK usage for:
- Wallet integration (MetaMask/private key)
- PandoraService provider management
- Real-time transaction monitoring
- Clean separation of user roles

## Security Notes

- Private keys are only stored in memory
- All transactions require explicit user approval
- Contract owner functions are protected by on-chain access control

## Advanced Features

### Custom Pandora Contract

The portal supports connecting to different Pandora contract deployments:

1. **Click the contract address** in the header (shows as "Pandora: 0xf49b...D4c5")
2. Enter the new contract address in the prompt
3. The page will reload with the new configuration

When using a custom contract:
- The contract badge turns orange to indicate non-default configuration
- The address persists through URL parameters for easy sharing
- Use `Ctrl+Shift+P` as a keyboard shortcut to change contracts