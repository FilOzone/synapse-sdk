/**
 * Subgraph queries
 */

export const QUERIES = {
  // queries for subgraphRetriever
  GET_APPROVED_PROVIDERS_FOR_COMMP: `
    query GetApprovedProvidersForCommP($cid: Bytes!) {
      roots(where: { cid: $cid }) {
        id
        proofSet {
          setId
          owner {
            id
            address
            pdpUrl
            pieceRetrievalUrl
            registeredAt
            status
            approvedAt
          }
        }
      }
    }
  `,
  GET_PROVIDER_BY_ADDRESS: `
    query Provider($providerId: ID!) {
      provider(id: $providerId) {
        id
        address
        pdpUrl
        pieceRetrievalUrl
        registeredAt
        approvedAt
      }
    }
  `,
  // flexible query templates
  GET_PROVIDERS_FLEXIBLE: `
    query ProvidersFlexible($where: Provider_filter, $first: Int, $skip: Int, $orderBy: Provider_orderBy, $orderDirection: OrderDirection) {
      providers(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        address
        pdpUrl
        pieceRetrievalUrl
        registeredAt
        approvedAt
        status
        totalFaultedPeriods
        totalFaultedRoots
        totalProofSets
        totalRoots
        totalDataSize
        createdAt
        updatedAt
      }
    }
  `,
  GET_PROOF_SETS_FLEXIBLE: `
    query ProofSetsFlexible($where: ProofSet_filter, $first: Int, $skip: Int, $orderBy: ProofSet_orderBy, $orderDirection: OrderDirection) {
      proofSets(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        setId
        listener
        clientAddr
        withCDN
        isActive
        leafCount
        challengeRange
        lastProvenEpoch
        nextChallengeEpoch
        totalRoots
        totalDataSize
        totalProofs
        totalProvedRoots
        totalFaultedPeriods
        totalFaultedRoots
        metadata
        createdAt
        updatedAt
        owner {
          id
          address
          pdpUrl
          pieceRetrievalUrl
          registeredAt
          approvedAt
        }
        rail {
          id
          railId
          token
          paymentRate
          lockupPeriod
          settledUpto
          endEpoch
        }
      }
    }
  `,
  GET_ROOTS_FLEXIBLE: `
    query RootsFlexible($where: Root_filter, $first: Int, $skip: Int, $orderBy: Root_orderBy, $orderDirection: OrderDirection) {
      roots(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        setId
        rootId
        rawSize
        leafCount
        cid
        removed
        totalProofsSubmitted
        totalPeriodsFaulted
        lastProvenEpoch
        lastProvenAt
        lastFaultedEpoch
        lastFaultedAt
        createdAt
        metadata
        proofSet {
          id
          setId
          isActive
          owner {
            id
            address
            pdpUrl
            pieceRetrievalUrl
            registeredAt
            approvedAt
          }
        }
      }
    }
  `,
  GET_FAULT_RECORDS_FLEXIBLE: `
    query FaultRecordsFlexible($where: FaultRecord_filter, $first: Int, $skip: Int, $orderBy: FaultRecord_orderBy, $orderDirection: OrderDirection) {
      faultRecords(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        proofSetId
        rootIds
        currentChallengeEpoch
        nextChallengeEpoch
        periodsFaulted
        deadline
        createdAt
        proofSet {
          id
          setId
          owner {
            id
            address
            pdpUrl
            pieceRetrievalUrl
            registeredAt
            approvedAt
          }
        }
      }
    }
  `
} as const
