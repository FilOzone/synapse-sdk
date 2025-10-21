# Synapse SDK Utilities

This directory contains utility scripts and tools for working with the Synapse SDK and Filecoin storage services.

## Scripts

### post-deploy-setup.js

Post-deployment setup script for newly deployed Warm Storage contracts. This script automates the complete setup process after deploying a new Warm Storage service contract.

### Prerequisites

1. **Deploy a Warm Storage contract** using the FilOzone deployment tools:

   ```bash
   # Clone the FilOzone filecoin-services repository
   git clone https://github.com/FilOzone/filecoin-services.git
   cd filecoin-services/service_contracts
   
   # Deploy to Calibration testnet
   PDP_VERIFIER_ADDRESS=0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC \
   PAYMENTS_CONTRACT_ADDRESS=0x0E690D3e60B0576D01352AB03b258115eb84A047 \
   ./tools/deploy-warm-storage-calibnet.sh
   ```

2. **Note the deployed contract address** from the deployment output.

3. **Ensure accounts have sufficient funds:**
   - Deployer account: FIL for gas costs
   - Client account: USDFC tokens for payments
   - Service provider account: FIL for gas costs

### Usage

```bash
cd synapse-sdk

# Set required environment variables
export DEPLOYER_PRIVATE_KEY=0x...        # Contract deployer/owner
export SP_PRIVATE_KEY=0x...              # Service provider
export CLIENT_PRIVATE_KEY=0x...          # Client account
export WARM_STORAGE_CONTRACT_ADDRESS=0x...    # Newly deployed contract
export NETWORK=calibration              # or 'mainnet'
export SP_PDP_URL=http://your-curio:4702 # Your Curio PDP endpoint
export SP_RETRIEVAL_URL=http://your-curio:4702 # Your retrieval endpoint

# Run the setup script
node utils/post-deploy-setup.js
```

### What It Does

1. **Service Provider Setup:**
   - Registers the service provider with the Warm Storage contract
   - Approves the registration (as contract owner)
   - Validates all permissions

2. **Client Payment Setup:**
   - Sets USDFC token allowances for the payments contract
   - Configures operator approval for the Warm Storage contract
   - Sets rate and lockup allowances (0.1 USDFC/epoch, 10 USDFC lockup)

3. **Status Verification:**
   - Checks all configurations are correct
   - Reports final system status
   - Provides transaction hashes for verification

### Common Contract Addresses (Calibration)

- **PDP Verifier:** `0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC`
- **Payments Contract:** `0x0E690D3e60B0576D01352AB03b258115eb84A047`
- **USDFC Token:** `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`

### Important Notes

- All operations are idempotent - safe to run multiple times
- The script validates current state before making changes
- Comprehensive error handling and status reporting

## HTML Tools

The HTML files in this directory are interactive browser-based tools for testing and debugging various aspects of the Synapse SDK. **Important**: These files must be served via HTTP/HTTPS, not loaded as `file://` URLs due to browser security restrictions.

### Setup for HTML Tools

To use the HTML tools, serve them via a local web server:

```bash
# Option 1: Using Python
cd synapse-sdk
python3 -m http.server 8000
# Then visit: http://localhost:8000/utils/tool-name.html

# Option 2: Using Node.js
npx st --dir . -nc -p 8000
# Then visit: http://localhost:8000/utils/tool-name.html

# Option 3: Using any other static file server
```

### pdp-auth-demo.html

Interactive demonstration of PDP (Proof of Data Possession) authentication using EIP-712 signatures.

**Features:**

- Connect to MetaMask or other browser wallets
- Generate EIP-712 signatures for PDP operations
- Test signature verification
- Demonstrate different PDP operation types (CreateDataSet, AddPieces, etc.)
- Visual interface for understanding the authentication flow

**Use Cases:**

- Learning how PDP authentication works
- Testing wallet integration
- Debugging signature generation issues
- Educational demonstrations

### service-provider-tool.html

Browser-based interface for service provider management operations.

**Features:**

- Connect to Warm Storage contracts
- Register as a service provider
- Check approval status
- View all approved providers
- Contract owner functions (approve/reject providers)
- Real-time status updates

**Use Cases:**

- Service provider onboarding
- Contract administration
- Testing provider registration flow
- Debugging provider approval issues

**Typical Workflow:**

1. Connect wallet (service provider or contract owner)
2. Enter Warm Storage contract address
3. Register as provider (if you're an SP)
4. Approve providers (if you're the contract owner)
5. Monitor provider status

### payment-apis-demo.html

Comprehensive demonstration of the enhanced payment APIs in the Synapse SDK.

**Features:**

- Full account balance and information display
- Storage cost calculator with CDN/non-CDN pricing
- Automatic funding analysis for storage requirements
- Service allowance management
- Interactive storage readiness checker

**Key Capabilities:**

1. **Account Management:**
   - View USDFC balances (wallet and payments contract)
   - Check account details including lockup information
   - Monitor available funds vs total funds

2. **Storage Cost Analysis:**
   - Calculate costs for any data size (bytes to TiB)
   - Compare CDN vs non-CDN pricing
   - Get per-epoch, per-day, and per-month breakdowns
   - Real-time pricing from Warm Storage contract

3. **Funding Analysis:**
   - Automatic check if you have enough funds for storage
   - Validates service operator allowances
   - Explains rate vs lockup allowances
   - Provides specific action items if requirements aren't met

4. **Service Allowances:**
   - Check current allowances for any service
   - Calculate required allowances for new storage
   - Prepare for storage uploads with pre-flight checks

**Use Cases:**

- Understanding payment requirements before storing data
- Testing payment flows in development
- Debugging allowance and balance issues
- Educational tool for learning about Filecoin storage economics

**Understanding the Payment System:**

- **Balance**: USDFC deposited in the Payments contract for storage costs
- **Rate Allowance**: Maximum per-epoch payment rate a service can set
- **Lockup Allowance**: Security deposit (30 days of storage) locked during rail creation

## Development Notes

### File Serving Requirements

All HTML files require HTTP/HTTPS serving because they:

- Load the Synapse SDK via ES6 modules
- Make blockchain RPC calls
- Access browser wallet APIs (MetaMask, etc.)
- Use modern JavaScript features restricted in `file://` context

### Security Considerations

- HTML tools are for development/testing only
- Never enter mainnet private keys in browser tools
- Use testnet accounts and contracts for testing
- Review all transaction details before signing

### Integration

The HTML tools are designed to work with:

- MetaMask and other browser wallets
- Both Calibration testnet and Filecoin mainnet
- The latest version of the Synapse SDK
- Modern browsers (Chrome, Firefox, Safari, Edge)
