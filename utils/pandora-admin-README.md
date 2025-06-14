# Pandora Admin Portal

A single-page web application for administering the Pandora storage provider contract on Filecoin.

## Features

- **Public View**: Browse all approved storage providers
- **Storage Provider Dashboard**: Register as a provider and check approval status
- **Owner Dashboard**: Approve/reject pending providers and manage approved providers
- **Real-time Updates**: Transaction monitoring and automatic UI updates
- **Wallet Support**: Connect via WalletConnect (including Safe), MetaMask, or private key
- **Safe Multisig Support**: Full support for Safe multisig wallets

## Prerequisites

1. Build the Synapse SDK browser bundle:
   ```bash
   npm run build:browser
   ```

2. Ensure you have access to Filecoin Calibration testnet

## Usage

1. Open `pandora-admin.html` in a web browser
2. Click "Connect Wallet" to authenticate:
   - **WalletConnect**: Connect any wallet including Safe multisig (recommended for organizations)
   - **MetaMask**: Use browser extension for personal wallets
   - **Private Key**: Enter key directly (for testing only)

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
- Multi-wallet integration (WalletConnect/MetaMask/private key)
- Safe multisig wallet detection and handling
- PandoraService provider management
- Real-time transaction monitoring
- Clean separation of user roles
- Asynchronous multisig transaction flows

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

## Safe Multisig Support

The Pandora Admin Portal fully supports Safe multisig wallets through Reown (formerly WalletConnect).

### Connecting a Safe Wallet

1. Click "Connect Wallet" in the header
2. Select "WalletConnect" option
3. Scan the QR code with your Safe mobile app OR:
   - Copy the connection URI
   - Go to the Safe web interface (app.safe.global)
   - Use the WalletConnect app to paste the URI
4. Approve the connection in your Safe

### Using Safe for Admin Operations

When using a Safe wallet:
- Transactions are **proposed** rather than immediately executed
- You'll receive a Safe transaction hash for tracking
- A link to the Safe interface is provided for easy access
- Other Safe owners must sign the transaction
- Transaction executes automatically when threshold is reached

### Transaction Flow with Safe

1. **Initiate Operation**: Click approve/reject/remove in the portal
2. **Sign Proposal**: Sign the transaction in your connected wallet
3. **Transaction Proposed**: Portal shows success with Safe transaction details
4. **Collect Signatures**: Share the Safe link with other owners
5. **Execution**: Transaction executes when enough signatures are collected

### Managing Signatures

After proposing a transaction:
1. Click the "View in Safe Interface" link shown in the portal
2. Share this link with other Safe owners
3. Each owner signs in the Safe interface
4. Monitor signature collection progress
5. Transaction auto-executes when threshold is met

### Safe Wallet Indicators

- **Wallet Status**: Shows 🔐 icon when connected to a Safe
- **Safe Info Panel**: Displays Safe details and dashboard link
- **Transaction Notifications**: Special formatting for Safe proposals
- **Proposal Links**: Direct links to Safe interface for each transaction

### Setting Up Reown

For developers setting up their own instance:

1. Get a Reown Project ID:
   - Visit https://cloud.reown.com
   - Create a new project (type: AppKit)
   - Copy the Project ID

2. Update the portal configuration:
   - Open `pandora-admin.html`
   - Replace `YOUR_PROJECT_ID` with your actual Project ID in the `REOWN_PROJECT_ID` constant
   - Add your domain to the allowed list in Reown Cloud

### Benefits of Safe Integration

- **Enhanced Security**: Multiple signatures required for critical operations
- **Team Management**: Multiple team members can manage providers
- **Audit Trail**: All proposals and signatures tracked on-chain
- **No Single Point of Failure**: Distributed control over admin functions