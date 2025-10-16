//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// FilecoinWarmStorageService
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const filecoinWarmStorageServiceAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_pdpVerifierAddress', internalType: 'address', type: 'address' },
      {
        name: '_paymentsContractAddress',
        internalType: 'address',
        type: 'address',
      },
      { name: '_usdfcTokenAddress', internalType: 'address', type: 'address' },
      {
        name: '_filCDNBeneficiaryAddress',
        internalType: 'address',
        type: 'address',
      },
      {
        name: '_serviceProviderRegistry',
        internalType: 'contract ServiceProviderRegistry',
        type: 'address',
      },
      {
        name: '_sessionKeyRegistry',
        internalType: 'contract SessionKeyRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'addApprovedProvider',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'totalBytes', internalType: 'uint256', type: 'uint256' }],
    name: 'calculateRatesPerEpoch',
    outputs: [
      { name: 'storageRate', internalType: 'uint256', type: 'uint256' },
      { name: 'cacheMissRate', internalType: 'uint256', type: 'uint256' },
      { name: 'cdnRate', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_maxProvingPeriod', internalType: 'uint64', type: 'uint64' },
      {
        name: '_challengeWindowSize',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'configureProvingPeriod',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'serviceProvider', internalType: 'address', type: 'address' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'dataSetCreated',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'dataSetDeleted',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', internalType: 'bytes1', type: 'bytes1' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'version', internalType: 'string', type: 'string' },
      { name: 'chainId', internalType: 'uint256', type: 'uint256' },
      { name: 'verifyingContract', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'extensions', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'extsload',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'slot', internalType: 'bytes32', type: 'bytes32' },
      { name: 'size', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'extsloadStruct',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'filCDNBeneficiaryAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getEffectiveRates',
    outputs: [
      { name: 'serviceFee', internalType: 'uint256', type: 'uint256' },
      { name: 'spPayment', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'epoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getProvingPeriodForEpoch',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getServicePrice',
    outputs: [
      {
        name: 'pricing',
        internalType: 'struct FilecoinWarmStorageService.ServicePricing',
        type: 'tuple',
        components: [
          {
            name: 'pricePerTiBPerMonthNoCDN',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'pricePerTiBPerMonthWithCDN',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'tokenAddress', internalType: 'address', type: 'address' },
          { name: 'epochsPerMonth', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_maxProvingPeriod', internalType: 'uint64', type: 'uint64' },
      {
        name: '_challengeWindowSize',
        internalType: 'uint256',
        type: 'uint256',
      },
      {
        name: '_filCDNControllerAddress',
        internalType: 'address',
        type: 'address',
      },
      { name: '_name', internalType: 'string', type: 'string' },
      { name: '_description', internalType: 'string', type: 'string' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'epoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'isEpochProven',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_viewContract', internalType: 'address', type: 'address' },
    ],
    name: 'migrate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'challengeEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'leafCount', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'nextProvingPeriod',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'paymentsContractAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pdpVerifierAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'firstAdded', internalType: 'uint256', type: 'uint256' },
      {
        name: 'pieceData',
        internalType: 'struct Cids.Cid[]',
        type: 'tuple[]',
        components: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
      },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'piecesAdded',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceIds', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'piecesScheduledRemove',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: 'challengeCount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'possessionProven',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'terminator', internalType: 'address', type: 'address' },
      { name: 'endEpoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'railTerminated',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'removeApprovedProvider',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'serviceCommissionBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'serviceProviderRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract ServiceProviderRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'sessionKeyRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract SessionKeyRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_viewContract', internalType: 'address', type: 'address' },
    ],
    name: 'setViewContract',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'oldServiceProvider', internalType: 'address', type: 'address' },
      { name: 'newServiceProvider', internalType: 'address', type: 'address' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'storageProviderChanged',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'terminateCDNService',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'terminateService',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newController', internalType: 'address', type: 'address' },
    ],
    name: 'transferFilCDNController',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newCommissionBps', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'updateServiceCommission',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'usdfcTokenAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposedAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'fromEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'toEpoch', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'validatePayment',
    outputs: [
      {
        name: 'result',
        internalType: 'struct IValidator.ValidationResult',
        type: 'tuple',
        components: [
          { name: 'modifiedAmount', internalType: 'uint256', type: 'uint256' },
          { name: 'settleUpto', internalType: 'uint256', type: 'uint256' },
          { name: 'note', internalType: 'string', type: 'string' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'viewContractAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'endEpoch',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cacheMissRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cdnRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CDNPaymentTerminated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'caller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'cacheMissRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cdnRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CDNServiceTerminated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'ContractUpgraded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pdpRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cacheMissRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cdnRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'payer',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'serviceProvider',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'payee',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'metadataKeys',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
      {
        name: 'metadataValues',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
    ],
    name: 'DataSetCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'oldServiceProvider',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newServiceProvider',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'DataSetServiceProviderChanged',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'EIP712DomainChanged' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'periodsFaulted',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'deadline',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FaultRecord',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldController',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'newController',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'FilCDNControllerChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'description',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'FilecoinServiceDeployed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'endEpoch',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'pdpRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'PDPPaymentTerminated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'originalAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'modifiedAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'faultedEpochs',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'PaymentArbitrated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pieceId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pieceCid',
        internalType: 'struct Cids.Cid',
        type: 'tuple',
        components: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
        indexed: false,
      },
      {
        name: 'keys',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
    ],
    name: 'PieceAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ProviderApproved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ProviderUnapproved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newRate',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RailRateUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'caller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'dataSetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pdpRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cacheMissRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cdnRailId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ServiceTerminated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'viewContract',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ViewContractSet',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'expectedPayer', internalType: 'address', type: 'address' },
      { name: 'expectedPayee', internalType: 'address', type: 'address' },
      { name: 'caller', internalType: 'address', type: 'address' },
    ],
    name: 'CallerNotPayerOrPayee',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'actual', internalType: 'address', type: 'address' },
    ],
    name: 'CallerNotPayments',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'windowStart', internalType: 'uint256', type: 'uint256' },
      { name: 'nowBlock', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ChallengeWindowTooEarly',
  },
  {
    type: 'error',
    inputs: [
      {
        name: 'commissionType',
        internalType: 'enum Errors.CommissionType',
        type: 'uint8',
      },
      { name: 'max', internalType: 'uint256', type: 'uint256' },
      { name: 'actual', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'CommissionExceedsMaximum',
  },
  {
    type: 'error',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'DataSetNotFoundForRail',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'DataSetNotRegistered',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'DataSetPaymentAlreadyTerminated',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'pdpEndEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'currentBlock', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'DataSetPaymentBeyondEndEpoch',
  },
  { type: 'error', inputs: [], name: 'DivisionByZero' },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'key', internalType: 'string', type: 'string' },
    ],
    name: 'DuplicateMetadataKey',
  },
  {
    type: 'error',
    inputs: [
      { name: 'implementation', internalType: 'address', type: 'address' },
    ],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'ExtraDataRequired' },
  { type: 'error', inputs: [], name: 'FailedCall' },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'FilCDNPaymentAlreadyTerminated',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'FilCDNServiceNotConfigured',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'minExpected', internalType: 'uint256', type: 'uint256' },
      { name: 'actual', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidChallengeCount',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'minAllowed', internalType: 'uint256', type: 'uint256' },
      { name: 'maxAllowed', internalType: 'uint256', type: 'uint256' },
      { name: 'actual', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidChallengeEpoch',
  },
  {
    type: 'error',
    inputs: [
      { name: 'maxProvingPeriod', internalType: 'uint256', type: 'uint256' },
      { name: 'challengeWindowSize', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidChallengeWindowSize',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidDataSetId',
  },
  {
    type: 'error',
    inputs: [
      { name: 'fromEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'toEpoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidEpochRange',
  },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'actual', internalType: 'address', type: 'address' },
    ],
    name: 'InvalidSignature',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expectedLength', internalType: 'uint256', type: 'uint256' },
      { name: 'actualLength', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidSignatureLength',
  },
  { type: 'error', inputs: [], name: 'MaxProvingPeriodZero' },
  {
    type: 'error',
    inputs: [
      { name: 'metadataArrayCount', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceCount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'MetadataArrayCountMismatch',
  },
  {
    type: 'error',
    inputs: [
      { name: 'keysLength', internalType: 'uint256', type: 'uint256' },
      { name: 'valuesLength', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'MetadataKeyAndValueLengthMismatch',
  },
  {
    type: 'error',
    inputs: [
      { name: 'index', internalType: 'uint256', type: 'uint256' },
      { name: 'maxAllowed', internalType: 'uint256', type: 'uint256' },
      { name: 'length', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'MetadataKeyExceedsMaxLength',
  },
  {
    type: 'error',
    inputs: [
      { name: 'index', internalType: 'uint256', type: 'uint256' },
      { name: 'maxAllowed', internalType: 'uint256', type: 'uint256' },
      { name: 'length', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'MetadataValueExceedsMaxLength',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'periodDeadline', internalType: 'uint256', type: 'uint256' },
      { name: 'nowBlock', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NextProvingPeriodAlreadyCalled',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'NoPDPPaymentRail',
  },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'actual', internalType: 'address', type: 'address' },
    ],
    name: 'OldServiceProviderMismatch',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'actual', internalType: 'address', type: 'address' },
    ],
    name: 'OnlyFilCDNControllerAllowed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'actual', internalType: 'address', type: 'address' },
    ],
    name: 'OnlyPDPVerifierAllowed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'actual', internalType: 'address', type: 'address' },
    ],
    name: 'OnlySelf',
  },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'pdpEndEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'cdnEndEpoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'PaymentRailsNotFinalized',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'ProofAlreadySubmitted',
  },
  {
    type: 'error',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'ProviderAlreadyApproved',
  },
  {
    type: 'error',
    inputs: [
      { name: 'provider', internalType: 'address', type: 'address' },
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ProviderNotApproved',
  },
  {
    type: 'error',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'ProviderNotInApprovedList',
  },
  {
    type: 'error',
    inputs: [{ name: 'provider', internalType: 'address', type: 'address' }],
    name: 'ProviderNotRegistered',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'ProvingNotStarted',
  },
  {
    type: 'error',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'nowBlock', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ProvingPeriodPassed',
  },
  {
    type: 'error',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'RailNotAssociated',
  },
  { type: 'error', inputs: [], name: 'ServiceContractMustTerminateRail' },
  {
    type: 'error',
    inputs: [
      { name: 'maxAllowed', internalType: 'uint256', type: 'uint256' },
      { name: 'keysLength', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'TooManyMetadataKeys',
  },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  {
    type: 'error',
    inputs: [{ name: 'v', internalType: 'uint8', type: 'uint8' }],
    name: 'UnsupportedSignatureV',
  },
  {
    type: 'error',
    inputs: [
      {
        name: 'field',
        internalType: 'enum Errors.AddressField',
        type: 'uint8',
      },
    ],
    name: 'ZeroAddress',
  },
] as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const filecoinWarmStorageServiceAddress = {
  314: '0x0000000000000000000000000000000000000000',
  314159: '0x0000000000000000000000000000000000000000',
} as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const filecoinWarmStorageServiceConfig = {
  address: filecoinWarmStorageServiceAddress,
  abi: filecoinWarmStorageServiceAbi,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// FilecoinWarmStorageServiceStateView
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const filecoinWarmStorageServiceStateViewAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_service',
        internalType: 'contract FilecoinWarmStorageService',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'challengeWindow',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'payer', internalType: 'address', type: 'address' }],
    name: 'clientDataSetIDs',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'payer', internalType: 'address', type: 'address' }],
    name: 'clientDataSets',
    outputs: [
      { name: 'dataSetIds', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'filCDNControllerAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getAllDataSetMetadata',
    outputs: [
      { name: 'keys', internalType: 'string[]', type: 'string[]' },
      { name: 'values', internalType: 'string[]', type: 'string[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getAllPieceMetadata',
    outputs: [
      { name: 'keys', internalType: 'string[]', type: 'string[]' },
      { name: 'values', internalType: 'string[]', type: 'string[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getApprovedProviders',
    outputs: [
      { name: 'providerIds', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getChallengesPerProof',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'client', internalType: 'address', type: 'address' }],
    name: 'getClientDataSets',
    outputs: [
      {
        name: 'infos',
        internalType: 'struct FilecoinWarmStorageService.DataSetInfo[]',
        type: 'tuple[]',
        components: [
          { name: 'pdpRailId', internalType: 'uint256', type: 'uint256' },
          { name: 'cacheMissRailId', internalType: 'uint256', type: 'uint256' },
          { name: 'cdnRailId', internalType: 'uint256', type: 'uint256' },
          { name: 'payer', internalType: 'address', type: 'address' },
          { name: 'payee', internalType: 'address', type: 'address' },
          { name: 'serviceProvider', internalType: 'address', type: 'address' },
          { name: 'commissionBps', internalType: 'uint256', type: 'uint256' },
          { name: 'clientDataSetId', internalType: 'uint256', type: 'uint256' },
          { name: 'pdpEndEpoch', internalType: 'uint256', type: 'uint256' },
          { name: 'providerId', internalType: 'uint256', type: 'uint256' },
          { name: 'cdnEndEpoch', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getDataSet',
    outputs: [
      {
        name: 'info',
        internalType: 'struct FilecoinWarmStorageService.DataSetInfo',
        type: 'tuple',
        components: [
          { name: 'pdpRailId', internalType: 'uint256', type: 'uint256' },
          { name: 'cacheMissRailId', internalType: 'uint256', type: 'uint256' },
          { name: 'cdnRailId', internalType: 'uint256', type: 'uint256' },
          { name: 'payer', internalType: 'address', type: 'address' },
          { name: 'payee', internalType: 'address', type: 'address' },
          { name: 'serviceProvider', internalType: 'address', type: 'address' },
          { name: 'commissionBps', internalType: 'uint256', type: 'uint256' },
          { name: 'clientDataSetId', internalType: 'uint256', type: 'uint256' },
          { name: 'pdpEndEpoch', internalType: 'uint256', type: 'uint256' },
          { name: 'providerId', internalType: 'uint256', type: 'uint256' },
          { name: 'cdnEndEpoch', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'key', internalType: 'string', type: 'string' },
    ],
    name: 'getDataSetMetadata',
    outputs: [
      { name: 'exists', internalType: 'bool', type: 'bool' },
      { name: 'value', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'leafCount', internalType: 'uint256', type: 'uint256' }],
    name: 'getDataSetSizeInBytes',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getMaxProvingPeriod',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getPDPConfig',
    outputs: [
      { name: 'maxProvingPeriod', internalType: 'uint64', type: 'uint64' },
      { name: 'challengeWindowSize', internalType: 'uint256', type: 'uint256' },
      { name: 'challengesPerProof', internalType: 'uint256', type: 'uint256' },
      {
        name: 'initChallengeWindowStart',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
      { name: 'key', internalType: 'string', type: 'string' },
    ],
    name: 'getPieceMetadata',
    outputs: [
      { name: 'exists', internalType: 'bool', type: 'bool' },
      { name: 'value', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'isProviderApproved',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'nextPDPChallengeWindowStart',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'dataSetId', internalType: 'uint256', type: 'uint256' },
      { name: 'periodId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'provenPeriods',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'provenThisPeriod',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'provingActivationEpoch',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'provingDeadline',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'railToDataSet',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'service',
    outputs: [
      {
        name: '',
        internalType: 'contract FilecoinWarmStorageService',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'error',
    inputs: [{ name: 'dataSetId', internalType: 'uint256', type: 'uint256' }],
    name: 'ProvingPeriodNotInitialized',
  },
] as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const filecoinWarmStorageServiceStateViewAddress = {
  314: '0x0000000000000000000000000000000000000000',
  314159: '0x0000000000000000000000000000000000000000',
} as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const filecoinWarmStorageServiceStateViewConfig = {
  address: filecoinWarmStorageServiceStateViewAddress,
  abi: filecoinWarmStorageServiceStateViewAbi,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// PDPVerifier
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const pdpVerifierAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'BURN_ACTOR',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'EXTRA_DATA_MAX_SIZE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FIL_USD_PRICE_FEED_ID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'LEAF_SIZE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_ENQUEUED_REMOVALS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_PIECE_SIZE_LOG2',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'NO_CHALLENGE_SCHEDULED',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'NO_PROVEN_EPOCH',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'PYTH',
    outputs: [{ name: '', internalType: 'contract IPyth', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'RANDOMNESS_PRECOMPILE',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'SECONDS_IN_DAY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'pieceData',
        internalType: 'struct Cids.Cid[]',
        type: 'tuple[]',
        components: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
      },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'addPieces',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'estimatedGasFee', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'calculateProofFee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'claimDataSetStorageProvider',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'listenerAddr', internalType: 'address', type: 'address' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'createDataSet',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'dataSetLive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'deleteDataSet',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'leafIndexs', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'findPieceIds',
    outputs: [
      {
        name: '',
        internalType: 'struct IPDPTypes.PieceIdAndOffset[]',
        type: 'tuple[]',
        components: [
          { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
          { name: 'offset', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getActivePieceCount',
    outputs: [
      { name: 'activeCount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getActivePieces',
    outputs: [
      {
        name: 'pieces',
        internalType: 'struct Cids.Cid[]',
        type: 'tuple[]',
        components: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
      },
      { name: 'pieceIds', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'rawSizes', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'hasMore', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getChallengeFinality',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getChallengeRange',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getDataSetLastProvenEpoch',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getDataSetLeafCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getDataSetListener',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getDataSetStorageProvider',
    outputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getFILUSDPrice',
    outputs: [
      { name: '', internalType: 'uint64', type: 'uint64' },
      { name: '', internalType: 'int32', type: 'int32' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getNextChallengeEpoch',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getNextDataSetId',
    outputs: [{ name: '', internalType: 'uint64', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getNextPieceId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getPieceCid',
    outputs: [
      {
        name: '',
        internalType: 'struct Cids.Cid',
        type: 'tuple',
        components: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getPieceLeafCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'epoch', internalType: 'uint256', type: 'uint256' }],
    name: 'getRandomness',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'setId', internalType: 'uint256', type: 'uint256' }],
    name: 'getScheduledRemovals',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_challengeFinality', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'migrate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'challengeEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'nextProvingPeriod',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'pieceChallengable',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'pieceLive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'newStorageProvider', internalType: 'address', type: 'address' },
    ],
    name: 'proposeDataSetStorageProvider',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'proofs',
        internalType: 'struct IPDPTypes.Proof[]',
        type: 'tuple[]',
        components: [
          { name: 'leaf', internalType: 'bytes32', type: 'bytes32' },
          { name: 'proof', internalType: 'bytes32[]', type: 'bytes32[]' },
        ],
      },
    ],
    name: 'provePossession',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'setId', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceIds', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'extraData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'schedulePieceDeletions',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'ContractUpgraded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'storageProvider',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'DataSetCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'deletedLeafCount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'DataSetDeleted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'DataSetEmpty',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'challengeEpoch',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'leafCount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'NextProvingPeriod',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pieceIds',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'pieceCids',
        internalType: 'struct Cids.Cid[]',
        type: 'tuple[]',
        components: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
        indexed: false,
      },
    ],
    name: 'PiecesAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pieceIds',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'PiecesRemoved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'challenges',
        internalType: 'struct IPDPTypes.PieceIdAndOffset[]',
        type: 'tuple[]',
        components: [
          { name: 'pieceId', internalType: 'uint256', type: 'uint256' },
          { name: 'offset', internalType: 'uint256', type: 'uint256' },
        ],
        indexed: false,
      },
    ],
    name: 'PossessionProven',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'fee', internalType: 'uint256', type: 'uint256', indexed: false },
      { name: 'price', internalType: 'uint64', type: 'uint64', indexed: false },
      { name: 'expo', internalType: 'int32', type: 'int32', indexed: false },
    ],
    name: 'ProofFeePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'setId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'oldStorageProvider',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newStorageProvider',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'StorageProviderChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [
      { name: 'implementation', internalType: 'address', type: 'address' },
    ],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedCall' },
  {
    type: 'error',
    inputs: [
      { name: 'idx', internalType: 'uint256', type: 'uint256' },
      { name: 'msg', internalType: 'string', type: 'string' },
    ],
    name: 'IndexedError',
  },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
] as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const pdpVerifierAddress = {
  314: '0x0000000000000000000000000000000000000000',
  314159: '0x0000000000000000000000000000000000000000',
} as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const pdpVerifierConfig = {
  address: pdpVerifierAddress,
  abi: pdpVerifierAbi,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Payments
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const paymentsAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'COMMISSION_MAX_BPS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'NETWORK_FEE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    name: 'accounts',
    outputs: [
      { name: 'funds', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupCurrent', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupRate', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupLastSettledAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'validator', internalType: 'address', type: 'address' },
      { name: 'commissionRateBps', internalType: 'uint256', type: 'uint256' },
      { name: 'serviceFeeRecipient', internalType: 'address', type: 'address' },
    ],
    name: 'createRail',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'depositWithPermit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'rateAllowance', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupAllowance', internalType: 'uint256', type: 'uint256' },
      { name: 'maxLockupPeriod', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'depositWithPermitAndApproveOperator',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
      { name: 'operator', internalType: 'address', type: 'address' },
      {
        name: 'rateAllowanceIncrease',
        internalType: 'uint256',
        type: 'uint256',
      },
      {
        name: 'lockupAllowanceIncrease',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'depositWithPermitAndIncreaseOperatorApproval',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'getAccountInfoIfSettled',
    outputs: [
      { name: 'fundedUntilEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'currentFunds', internalType: 'uint256', type: 'uint256' },
      { name: 'availableFunds', internalType: 'uint256', type: 'uint256' },
      { name: 'currentLockupRate', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'getRail',
    outputs: [
      {
        name: '',
        internalType: 'struct Payments.RailView',
        type: 'tuple',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'from', internalType: 'address', type: 'address' },
          { name: 'to', internalType: 'address', type: 'address' },
          { name: 'operator', internalType: 'address', type: 'address' },
          { name: 'validator', internalType: 'address', type: 'address' },
          { name: 'paymentRate', internalType: 'uint256', type: 'uint256' },
          { name: 'lockupPeriod', internalType: 'uint256', type: 'uint256' },
          { name: 'lockupFixed', internalType: 'uint256', type: 'uint256' },
          { name: 'settledUpTo', internalType: 'uint256', type: 'uint256' },
          { name: 'endEpoch', internalType: 'uint256', type: 'uint256' },
          {
            name: 'commissionRateBps',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'serviceFeeRecipient',
            internalType: 'address',
            type: 'address',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'payee', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'getRailsForPayeeAndToken',
    outputs: [
      {
        name: '',
        internalType: 'struct Payments.RailInfo[]',
        type: 'tuple[]',
        components: [
          { name: 'railId', internalType: 'uint256', type: 'uint256' },
          { name: 'isTerminated', internalType: 'bool', type: 'bool' },
          { name: 'endEpoch', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'payer', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'getRailsForPayerAndToken',
    outputs: [
      {
        name: '',
        internalType: 'struct Payments.RailInfo[]',
        type: 'tuple[]',
        components: [
          { name: 'railId', internalType: 'uint256', type: 'uint256' },
          { name: 'isTerminated', internalType: 'bool', type: 'bool' },
          { name: 'endEpoch', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'getRateChangeQueueSize',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
      {
        name: 'rateAllowanceIncrease',
        internalType: 'uint256',
        type: 'uint256',
      },
      {
        name: 'lockupAllowanceIncrease',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'increaseOperatorApproval',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'period', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupFixed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'modifyRailLockup',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'newRate', internalType: 'uint256', type: 'uint256' },
      { name: 'oneTimePayment', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'modifyRailPayment',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    name: 'operatorApprovals',
    outputs: [
      { name: 'isApproved', internalType: 'bool', type: 'bool' },
      { name: 'rateAllowance', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupAllowance', internalType: 'uint256', type: 'uint256' },
      { name: 'rateUsage', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupUsage', internalType: 'uint256', type: 'uint256' },
      { name: 'maxLockupPeriod', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
      { name: 'rateAllowance', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupAllowance', internalType: 'uint256', type: 'uint256' },
      { name: 'maxLockupPeriod', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setOperatorApproval',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'untilEpoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'settleRail',
    outputs: [
      { name: 'totalSettledAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'totalNetPayeeAmount', internalType: 'uint256', type: 'uint256' },
      {
        name: 'totalOperatorCommission',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: 'finalSettledEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'note', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'settleTerminatedRailWithoutValidation',
    outputs: [
      { name: 'totalSettledAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'totalNetPayeeAmount', internalType: 'uint256', type: 'uint256' },
      {
        name: 'totalOperatorCommission',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: 'finalSettledEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'note', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'terminateRail',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'withdrawTo',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'lockupCurrent',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'lockupRate',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'lockupLastSettledAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'AccountLockupSettled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'usedPermit',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'DepositRecorded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'client',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
      {
        name: 'rateAllowance',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'lockupAllowance',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'maxLockupPeriod',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'OperatorApprovalUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'payer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'payee',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'validator',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'serviceFeeRecipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'commissionRateBps',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RailCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'RailFinalized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'oldLockupPeriod',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newLockupPeriod',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'oldLockupFixed',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newLockupFixed',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RailLockupModified',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'netPayeeAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'operatorCommission',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RailOneTimePaymentProcessed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'oldRate',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newRate',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RailRateModified',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'totalSettledAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'totalNetPayeeAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'operatorCommission',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'settledUpTo',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RailSettled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'railId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'by', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'endEpoch',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RailTerminated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'WithdrawRecorded',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'maxSettlementEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'blockNumber', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'CannotModifyTerminatedRailBeyondEndEpoch',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'maxAllowedEpoch', internalType: 'uint256', type: 'uint256' },
      { name: 'attemptedEpoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'CannotSettleFutureEpochs',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'requiredBlock', internalType: 'uint256', type: 'uint256' },
      { name: 'currentBlock', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'CannotSettleTerminatedRailBeforeMaxEpoch',
  },
  {
    type: 'error',
    inputs: [
      { name: 'maxAllowed', internalType: 'uint256', type: 'uint256' },
      { name: 'actual', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'CommissionRateTooHigh',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'oldLockup', internalType: 'uint256', type: 'uint256' },
      { name: 'currentLockup', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'CurrentLockupLessThanOldLockup',
  },
  {
    type: 'error',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'currentLockup', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupReduction', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientCurrentLockup',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'required', internalType: 'uint256', type: 'uint256' },
      { name: 'actual', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientFundsForOneTimePayment',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
      { name: 'required', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientFundsForSettlement',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
      { name: 'required', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientLockupForSettlement',
  },
  {
    type: 'error',
    inputs: [
      { name: 'required', internalType: 'uint256', type: 'uint256' },
      { name: 'sent', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientNativeTokenForBurn',
  },
  {
    type: 'error',
    inputs: [
      { name: 'available', internalType: 'uint256', type: 'uint256' },
      { name: 'requested', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InsufficientUnlockedFunds',
  },
  {
    type: 'error',
    inputs: [
      {
        name: 'nextRateChangeUntilEpoch',
        internalType: 'uint256',
        type: 'uint256',
      },
      { name: 'processedEpoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidRateChangeQueueState',
  },
  {
    type: 'error',
    inputs: [
      { name: 'actualPeriod', internalType: 'uint256', type: 'uint256' },
      { name: 'actualLockupFixed', internalType: 'uint256', type: 'uint256' },
      { name: 'attemptedPeriod', internalType: 'uint256', type: 'uint256' },
      {
        name: 'attemptedLockupFixed',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'InvalidTerminatedRailModification',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'lockupCurrent', internalType: 'uint256', type: 'uint256' },
      { name: 'fundsCurrent', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'LockupExceedsFundsInvariant',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'actualLockupFixed', internalType: 'uint256', type: 'uint256' },
      {
        name: 'attemptedLockupFixed',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'LockupFixedIncreaseNotAllowedDueToInsufficientFunds',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'expectedLockup', internalType: 'uint256', type: 'uint256' },
      { name: 'actualLockup', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'LockupInconsistencyDuringRailFinalization',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'isSettled', internalType: 'bool', type: 'bool' },
      { name: 'currentRate', internalType: 'uint256', type: 'uint256' },
      { name: 'attemptedRate', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'LockupNotSettledRateChangeNotAllowed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'actualLockupPeriod', internalType: 'uint256', type: 'uint256' },
      {
        name: 'attemptedLockupPeriod',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'LockupPeriodChangeNotAllowedDueToInsufficientFunds',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'maxAllowedPeriod', internalType: 'uint256', type: 'uint256' },
      { name: 'requestedPeriod', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'LockupPeriodExceedsOperatorMaximum',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'paymentRate', internalType: 'uint256', type: 'uint256' },
      { name: 'lockupRate', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'LockupRateInconsistent',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'lockupRate', internalType: 'uint256', type: 'uint256' },
      { name: 'oldRate', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'LockupRateLessThanOldRate',
  },
  { type: 'error', inputs: [], name: 'MissingServiceFeeRecipient' },
  {
    type: 'error',
    inputs: [
      { name: 'required', internalType: 'uint256', type: 'uint256' },
      { name: 'sent', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'MustSendExactNativeAmount',
  },
  {
    type: 'error',
    inputs: [{ name: 'sent', internalType: 'uint256', type: 'uint256' }],
    name: 'NativeTokenNotAccepted',
  },
  { type: 'error', inputs: [], name: 'NativeTokenNotSupported' },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NativeTransferFailed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'expectedSettledUpTo', internalType: 'uint256', type: 'uint256' },
      { name: 'actualSettledUpTo', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NoProgressInSettlement',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'allowedClient', internalType: 'address', type: 'address' },
      { name: 'allowedOperator', internalType: 'address', type: 'address' },
      { name: 'caller', internalType: 'address', type: 'address' },
    ],
    name: 'NotAuthorizedToTerminateRail',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'available', internalType: 'uint256', type: 'uint256' },
      { name: 'required', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'OneTimePaymentExceedsLockup',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'caller', internalType: 'address', type: 'address' },
    ],
    name: 'OnlyRailClientAllowed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'caller', internalType: 'address', type: 'address' },
    ],
    name: 'OnlyRailOperatorAllowed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expectedFrom', internalType: 'address', type: 'address' },
      { name: 'expectedOperator', internalType: 'address', type: 'address' },
      { name: 'expectedTo', internalType: 'address', type: 'address' },
      { name: 'caller', internalType: 'address', type: 'address' },
    ],
    name: 'OnlyRailParticipantAllowed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'allowed', internalType: 'uint256', type: 'uint256' },
      { name: 'attemptedUsage', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'OperatorLockupAllowanceExceeded',
  },
  {
    type: 'error',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'OperatorNotApproved',
  },
  {
    type: 'error',
    inputs: [
      { name: 'allowed', internalType: 'uint256', type: 'uint256' },
      { name: 'attemptedUsage', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'OperatorRateAllowanceExceeded',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'address', type: 'address' },
      { name: 'actual', internalType: 'address', type: 'address' },
    ],
    name: 'PermitRecipientMustBeMsgSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'RailAlreadyTerminated',
  },
  {
    type: 'error',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'RailInactiveOrSettled',
  },
  {
    type: 'error',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'RailNotTerminated',
  },
  {
    type: 'error',
    inputs: [{ name: 'railId', internalType: 'uint256', type: 'uint256' }],
    name: 'RateChangeNotAllowedOnTerminatedRail',
  },
  {
    type: 'error',
    inputs: [
      { name: 'nextUntilEpoch', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'RateChangeQueueNotEmpty',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'maxAllowed', internalType: 'uint256', type: 'uint256' },
      { name: 'attempted', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ValidatorModifiedAmountExceedsMaximum',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'allowedStart', internalType: 'uint256', type: 'uint256' },
      { name: 'attemptedStart', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ValidatorSettledBeforeSegmentStart',
  },
  {
    type: 'error',
    inputs: [
      { name: 'railId', internalType: 'uint256', type: 'uint256' },
      { name: 'allowedEnd', internalType: 'uint256', type: 'uint256' },
      { name: 'attemptedEnd', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ValidatorSettledBeyondSegmentEnd',
  },
  {
    type: 'error',
    inputs: [{ name: 'varName', internalType: 'string', type: 'string' }],
    name: 'ZeroAddressNotAllowed',
  },
] as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const paymentsAddress = {
  314: '0x0000000000000000000000000000000000000000',
  314159: '0x0000000000000000000000000000000000000000',
} as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const paymentsConfig = {
  address: paymentsAddress,
  abi: paymentsAbi,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ServiceProviderRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const serviceProviderRegistryAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'BURN_ACTOR',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CAPABILITIES',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CAPABILITY_KEY_LENGTH',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CAPABILITY_VALUE_LENGTH',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'REGISTRATION_FEE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
    ],
    name: 'activeProductTypeProviderCount',
    outputs: [{ name: 'count', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'activeProviderCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'productData', internalType: 'bytes', type: 'bytes' },
      { name: 'capabilityKeys', internalType: 'string[]', type: 'string[]' },
      { name: 'capabilityValues', internalType: 'string[]', type: 'string[]' },
    ],
    name: 'addProduct',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerAddress', internalType: 'address', type: 'address' },
    ],
    name: 'addressToProviderId',
    outputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
    name: 'decodePDPOffering',
    outputs: [
      {
        name: '',
        internalType: 'struct ServiceProviderRegistryStorage.PDPOffering',
        type: 'tuple',
        components: [
          { name: 'serviceURL', internalType: 'string', type: 'string' },
          {
            name: 'minPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'maxPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'ipniPiece', internalType: 'bool', type: 'bool' },
          { name: 'ipniIpfs', internalType: 'bool', type: 'bool' },
          {
            name: 'storagePricePerTibPerMonth',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'minProvingPeriodInEpochs',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'location', internalType: 'string', type: 'string' },
          {
            name: 'paymentTokenAddress',
            internalType: 'contract IERC20',
            type: 'address',
          },
        ],
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', internalType: 'bytes1', type: 'bytes1' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'version', internalType: 'string', type: 'string' },
      { name: 'chainId', internalType: 'uint256', type: 'uint256' },
      { name: 'verifyingContract', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'extensions', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'pdpOffering',
        internalType: 'struct ServiceProviderRegistryStorage.PDPOffering',
        type: 'tuple',
        components: [
          { name: 'serviceURL', internalType: 'string', type: 'string' },
          {
            name: 'minPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'maxPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'ipniPiece', internalType: 'bool', type: 'bool' },
          { name: 'ipniIpfs', internalType: 'bool', type: 'bool' },
          {
            name: 'storagePricePerTibPerMonth',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'minProvingPeriodInEpochs',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'location', internalType: 'string', type: 'string' },
          {
            name: 'paymentTokenAddress',
            internalType: 'contract IERC20',
            type: 'address',
          },
        ],
      },
    ],
    name: 'encodePDPOffering',
    outputs: [{ name: '', internalType: 'bytes', type: 'bytes' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getActiveProvidersByProductType',
    outputs: [
      {
        name: 'result',
        internalType:
          'struct ServiceProviderRegistryStorage.PaginatedProviders',
        type: 'tuple',
        components: [
          {
            name: 'providers',
            internalType:
              'struct ServiceProviderRegistryStorage.ProviderWithProduct[]',
            type: 'tuple[]',
            components: [
              { name: 'providerId', internalType: 'uint256', type: 'uint256' },
              {
                name: 'providerInfo',
                internalType:
                  'struct ServiceProviderRegistryStorage.ServiceProviderInfo',
                type: 'tuple',
                components: [
                  {
                    name: 'serviceProvider',
                    internalType: 'address',
                    type: 'address',
                  },
                  { name: 'payee', internalType: 'address', type: 'address' },
                  { name: 'name', internalType: 'string', type: 'string' },
                  {
                    name: 'description',
                    internalType: 'string',
                    type: 'string',
                  },
                  { name: 'isActive', internalType: 'bool', type: 'bool' },
                  {
                    name: 'providerId',
                    internalType: 'uint256',
                    type: 'uint256',
                  },
                ],
              },
              {
                name: 'product',
                internalType:
                  'struct ServiceProviderRegistryStorage.ServiceProduct',
                type: 'tuple',
                components: [
                  {
                    name: 'productType',
                    internalType:
                      'enum ServiceProviderRegistryStorage.ProductType',
                    type: 'uint8',
                  },
                  { name: 'productData', internalType: 'bytes', type: 'bytes' },
                  {
                    name: 'capabilityKeys',
                    internalType: 'string[]',
                    type: 'string[]',
                  },
                  { name: 'isActive', internalType: 'bool', type: 'bool' },
                ],
              },
            ],
          },
          { name: 'hasMore', internalType: 'bool', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getAllActiveProviders',
    outputs: [
      { name: 'providerIds', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'hasMore', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getNextProviderId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'getPDPService',
    outputs: [
      {
        name: 'pdpOffering',
        internalType: 'struct ServiceProviderRegistryStorage.PDPOffering',
        type: 'tuple',
        components: [
          { name: 'serviceURL', internalType: 'string', type: 'string' },
          {
            name: 'minPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'maxPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'ipniPiece', internalType: 'bool', type: 'bool' },
          { name: 'ipniIpfs', internalType: 'bool', type: 'bool' },
          {
            name: 'storagePricePerTibPerMonth',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'minProvingPeriodInEpochs',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'location', internalType: 'string', type: 'string' },
          {
            name: 'paymentTokenAddress',
            internalType: 'contract IERC20',
            type: 'address',
          },
        ],
      },
      { name: 'capabilityKeys', internalType: 'string[]', type: 'string[]' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
    ],
    name: 'getProduct',
    outputs: [
      { name: 'productData', internalType: 'bytes', type: 'bytes' },
      { name: 'capabilityKeys', internalType: 'string[]', type: 'string[]' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'keys', internalType: 'string[]', type: 'string[]' },
    ],
    name: 'getProductCapabilities',
    outputs: [
      { name: 'exists', internalType: 'bool[]', type: 'bool[]' },
      { name: 'values', internalType: 'string[]', type: 'string[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'key', internalType: 'string', type: 'string' },
    ],
    name: 'getProductCapability',
    outputs: [
      { name: 'exists', internalType: 'bool', type: 'bool' },
      { name: 'value', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'getProvider',
    outputs: [
      {
        name: 'info',
        internalType:
          'struct ServiceProviderRegistryStorage.ServiceProviderInfo',
        type: 'tuple',
        components: [
          { name: 'serviceProvider', internalType: 'address', type: 'address' },
          { name: 'payee', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'description', internalType: 'string', type: 'string' },
          { name: 'isActive', internalType: 'bool', type: 'bool' },
          { name: 'providerId', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerAddress', internalType: 'address', type: 'address' },
    ],
    name: 'getProviderByAddress',
    outputs: [
      {
        name: 'info',
        internalType:
          'struct ServiceProviderRegistryStorage.ServiceProviderInfo',
        type: 'tuple',
        components: [
          { name: 'serviceProvider', internalType: 'address', type: 'address' },
          { name: 'payee', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'description', internalType: 'string', type: 'string' },
          { name: 'isActive', internalType: 'bool', type: 'bool' },
          { name: 'providerId', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getProviderCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerAddress', internalType: 'address', type: 'address' },
    ],
    name: 'getProviderIdByAddress',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getProvidersByProductType',
    outputs: [
      {
        name: 'result',
        internalType:
          'struct ServiceProviderRegistryStorage.PaginatedProviders',
        type: 'tuple',
        components: [
          {
            name: 'providers',
            internalType:
              'struct ServiceProviderRegistryStorage.ProviderWithProduct[]',
            type: 'tuple[]',
            components: [
              { name: 'providerId', internalType: 'uint256', type: 'uint256' },
              {
                name: 'providerInfo',
                internalType:
                  'struct ServiceProviderRegistryStorage.ServiceProviderInfo',
                type: 'tuple',
                components: [
                  {
                    name: 'serviceProvider',
                    internalType: 'address',
                    type: 'address',
                  },
                  { name: 'payee', internalType: 'address', type: 'address' },
                  { name: 'name', internalType: 'string', type: 'string' },
                  {
                    name: 'description',
                    internalType: 'string',
                    type: 'string',
                  },
                  { name: 'isActive', internalType: 'bool', type: 'bool' },
                  {
                    name: 'providerId',
                    internalType: 'uint256',
                    type: 'uint256',
                  },
                ],
              },
              {
                name: 'product',
                internalType:
                  'struct ServiceProviderRegistryStorage.ServiceProduct',
                type: 'tuple',
                components: [
                  {
                    name: 'productType',
                    internalType:
                      'enum ServiceProviderRegistryStorage.ProductType',
                    type: 'uint8',
                  },
                  { name: 'productData', internalType: 'bytes', type: 'bytes' },
                  {
                    name: 'capabilityKeys',
                    internalType: 'string[]',
                    type: 'string[]',
                  },
                  { name: 'isActive', internalType: 'bool', type: 'bool' },
                ],
              },
            ],
          },
          { name: 'hasMore', internalType: 'bool', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'isProviderActive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'provider', internalType: 'address', type: 'address' }],
    name: 'isRegisteredProvider',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newVersion', internalType: 'string', type: 'string' }],
    name: 'migrate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'key', internalType: 'string', type: 'string' },
    ],
    name: 'productCapabilities',
    outputs: [{ name: 'value', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
    ],
    name: 'productTypeProviderCount',
    outputs: [{ name: 'count', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
    ],
    name: 'providerHasProduct',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
    ],
    name: 'providerProducts',
    outputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'productData', internalType: 'bytes', type: 'bytes' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    name: 'providers',
    outputs: [
      { name: 'serviceProvider', internalType: 'address', type: 'address' },
      { name: 'payee', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
      { name: 'providerId', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'payee', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'productData', internalType: 'bytes', type: 'bytes' },
      { name: 'capabilityKeys', internalType: 'string[]', type: 'string[]' },
      { name: 'capabilityValues', internalType: 'string[]', type: 'string[]' },
    ],
    name: 'registerProvider',
    outputs: [{ name: 'providerId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
    ],
    name: 'removeProduct',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'removeProvider',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'pdpOffering',
        internalType: 'struct ServiceProviderRegistryStorage.PDPOffering',
        type: 'tuple',
        components: [
          { name: 'serviceURL', internalType: 'string', type: 'string' },
          {
            name: 'minPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'maxPieceSizeInBytes',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'ipniPiece', internalType: 'bool', type: 'bool' },
          { name: 'ipniIpfs', internalType: 'bool', type: 'bool' },
          {
            name: 'storagePricePerTibPerMonth',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'minProvingPeriodInEpochs',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'location', internalType: 'string', type: 'string' },
          {
            name: 'paymentTokenAddress',
            internalType: 'contract IERC20',
            type: 'address',
          },
        ],
      },
      { name: 'capabilityKeys', internalType: 'string[]', type: 'string[]' },
      { name: 'capabilityValues', internalType: 'string[]', type: 'string[]' },
    ],
    name: 'updatePDPServiceWithCapabilities',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
      },
      { name: 'productData', internalType: 'bytes', type: 'bytes' },
      { name: 'capabilityKeys', internalType: 'string[]', type: 'string[]' },
      { name: 'capabilityValues', internalType: 'string[]', type: 'string[]' },
    ],
    name: 'updateProduct',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
    ],
    name: 'updateProviderInfo',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'ContractUpgraded',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'EIP712DomainChanged' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
        indexed: true,
      },
      {
        name: 'serviceUrl',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'serviceProvider',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'capabilityKeys',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
      {
        name: 'capabilityValues',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
    ],
    name: 'ProductAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
        indexed: true,
      },
    ],
    name: 'ProductRemoved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'productType',
        internalType: 'enum ServiceProviderRegistryStorage.ProductType',
        type: 'uint8',
        indexed: true,
      },
      {
        name: 'serviceUrl',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'serviceProvider',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'capabilityKeys',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
      {
        name: 'capabilityValues',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
    ],
    name: 'ProductUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ProviderInfoUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'serviceProvider',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'payee',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProviderRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'providerId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ProviderRemoved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [
      { name: 'implementation', internalType: 'address', type: 'address' },
    ],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedCall' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
] as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const serviceProviderRegistryAddress = {
  314: '0x0000000000000000000000000000000000000000',
  314159: '0x0000000000000000000000000000000000000000',
} as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const serviceProviderRegistryConfig = {
  address: serviceProviderRegistryAddress,
  abi: serviceProviderRegistryAbi,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SessionKeyRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const sessionKeyRegistryAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'signer', internalType: 'address', type: 'address' },
      { name: 'permission', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'authorizationExpiry',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'signer', internalType: 'address', type: 'address' },
      { name: 'expiry', internalType: 'uint256', type: 'uint256' },
      { name: 'permissions', internalType: 'bytes32[]', type: 'bytes32[]' },
    ],
    name: 'login',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'signer', internalType: 'address payable', type: 'address' },
      { name: 'expiry', internalType: 'uint256', type: 'uint256' },
      { name: 'permissions', internalType: 'bytes32[]', type: 'bytes32[]' },
    ],
    name: 'loginAndFund',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'signer', internalType: 'address', type: 'address' },
      { name: 'permissions', internalType: 'bytes32[]', type: 'bytes32[]' },
    ],
    name: 'revoke',
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const sessionKeyRegistryAddress = {
  314: '0x0000000000000000000000000000000000000000',
  314159: '0x0000000000000000000000000000000000000000',
} as const

/**
 * - [__View Contract on Filecoin Mainnet Filfox__](https://filfox.info/en/address/0x0000000000000000000000000000000000000000)
 * - [__View Contract on Filecoin Calibration Filscan__](https://calibration.filscan.io/address/0x0000000000000000000000000000000000000000)
 */
export const sessionKeyRegistryConfig = {
  address: sessionKeyRegistryAddress,
  abi: sessionKeyRegistryAbi,
} as const
