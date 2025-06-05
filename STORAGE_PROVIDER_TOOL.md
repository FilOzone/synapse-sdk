# StorageProviderTool Documentation

The `StorageProviderTool` provides a TypeScript/JavaScript interface for interacting with the SimplePDPServiceWithPayments contract's storage provider registry functions.

## Overview

Storage providers must register with the SimplePDPServiceWithPayments contract before they can participate in the PDP system. The registration process involves:

1. **Storage Provider** registers their service URLs
2. **Contract Owner** approves the registration
3. **Storage Provider** can then be used as a payee in proof sets

## Usage

### Import

```typescript
import { StorageProviderTool } from '@filoz/synapse-sdk/pdp'
```

### Creating an Instance

```typescript
// With ethers signer (MetaMask, private key, etc.)
const tool = new StorageProviderTool(contractAddress, signer)
```

## Methods

### For Storage Providers

#### `register(pdpUrl, pieceRetrievalUrl)`
Register as a service provider by providing your service URLs.

```typescript
// Storage provider registers their URLs
const tx = await tool.register(
  'https://pdp.example.com',      // PDP API endpoint
  'https://retrieve.example.com'  // Piece retrieval endpoint
)
await tx.wait()
```

**Who can call**: Anyone (typically storage providers)
**Effect**: Creates a pending registration that must be approved by the contract owner

### For Contract Owners

#### `approve(providerAddress)`
Approve a pending service provider registration.

```typescript
// Contract owner approves a provider
const tx = await tool.approve('0x1234...')
await tx.wait()
```

**Who can call**: Only the contract owner
**Effect**: Moves provider from pending to approved status

#### `reject(providerAddress)`
Reject a pending service provider registration.

```typescript
// Contract owner rejects a provider
const tx = await tool.reject('0x1234...')
await tx.wait()
```

**Who can call**: Only the contract owner
**Effect**: Removes the pending registration

#### `remove(providerId)`
Remove an already approved service provider.

```typescript
// Contract owner removes an approved provider
const tx = await tool.remove(1n) // Provider ID 1
await tx.wait()
```

**Who can call**: Only the contract owner
**Effect**: Revokes the provider's approved status

### Query Methods

#### `isApproved(providerAddress)`
Check if a provider address is approved.

```typescript
const isApproved = await tool.isApproved('0x1234...')
console.log(isApproved) // true or false
```

#### `getProviderIdByAddress(providerAddress)`
Get the ID assigned to an approved provider.

```typescript
const providerId = await tool.getProviderIdByAddress('0x1234...')
console.log(providerId) // 0n if not approved, otherwise the ID
```

#### `getApprovedProvider(providerId)`
Get detailed information about an approved provider.

```typescript
const info = await tool.getApprovedProvider(1n)
console.log(info)
// {
//   owner: '0x1234...',
//   pdpUrl: 'https://pdp.example.com',
//   pieceRetrievalUrl: 'https://retrieve.example.com',
//   registeredAt: 12345678n,
//   approvedAt: 12345690n
// }
```

#### `getPendingProvider(providerAddress)`
Get information about a pending registration.

```typescript
const pending = await tool.getPendingProvider('0x1234...')
if (pending.registeredAt > 0n) {
  console.log('Registration pending:', pending)
}
```

#### `getAllApprovedProviders()`
Convenience method to get all approved providers.

```typescript
const providers = await tool.getAllApprovedProviders()
providers.forEach(({ id, info }) => {
  console.log(`Provider #${id}:`, info)
})
```

#### `isOwner()`
Check if the current signer is the contract owner.

```typescript
const isOwner = await tool.isOwner()
if (isOwner) {
  console.log('You can approve/reject providers')
}
```

## Complete Example

```typescript
import { ethers } from 'ethers'
import { StorageProviderTool } from '@filoz/synapse-sdk/pdp'

// Setup
const provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
const signer = new ethers.Wallet(privateKey, provider)
const tool = new StorageProviderTool(contractAddress, signer)

// Storage Provider Registration Flow
async function registerAsProvider() {
  // 1. Check if already approved
  const myAddress = await signer.getAddress()
  const isApproved = await tool.isApproved(myAddress)
  
  if (isApproved) {
    console.log('Already approved!')
    const id = await tool.getProviderIdByAddress(myAddress)
    const info = await tool.getApprovedProvider(id)
    console.log('My provider info:', info)
    return
  }
  
  // 2. Check if registration is pending
  const pending = await tool.getPendingProvider(myAddress)
  if (pending.registeredAt > 0n) {
    console.log('Registration already pending since block', pending.registeredAt)
    return
  }
  
  // 3. Register
  console.log('Registering as provider...')
  const tx = await tool.register(
    'https://my-pdp-api.example.com',
    'https://my-retrieval.example.com'
  )
  await tx.wait()
  console.log('Registration submitted! Contact contract owner for approval.')
}

// Contract Owner Approval Flow
async function approveProviders() {
  // Check if we're the owner
  const isOwner = await tool.isOwner()
  if (!isOwner) {
    console.log('Not the contract owner')
    return
  }
  
  // Check pending registrations (would need to listen to events or know addresses)
  const providerToApprove = '0x1234...'
  
  const pending = await tool.getPendingProvider(providerToApprove)
  if (pending.registeredAt === 0n) {
    console.log('No pending registration for this address')
    return
  }
  
  console.log('Pending registration:', pending)
  
  // Approve the provider
  const tx = await tool.approve(providerToApprove)
  await tx.wait()
  console.log('Provider approved!')
  
  // Verify approval
  const providerId = await tool.getProviderIdByAddress(providerToApprove)
  console.log('Assigned provider ID:', providerId)
}
```

## HTML Tool

An interactive HTML tool is available at `utils/storage-provider-tool.html` that provides a user interface for all these operations. It supports both MetaMask and private key authentication.