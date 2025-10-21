import { useDataSets, useProviders } from '@filoz/synapse-react'
import { useAccount } from 'wagmi'
import { Separator } from './ui/separator.tsx'
import { Skeleton } from './ui/skeleton.tsx'
import { DataSetsSection } from './warm-storage/data-sets-section.tsx'
import { UploadsSection } from './warm-storage/uploads-section.tsx'

export function WarmStorageService() {
  const { address } = useAccount()
  const { data: providers } = useProviders()

  const { data: dataSets } = useDataSets({
    address,
  })

  return (
    <>
      {dataSets && providers ? (
        <>
          {dataSets?.length > 0 && (
            <>
              <UploadsSection dataSets={dataSets} providers={providers} />
              <Separator className="my-4" />
            </>
          )}
          <DataSetsSection dataSets={dataSets} providers={providers} />
        </>
      ) : (
        <Skeleton className="w-full h-20" />
      )}
    </>
  )
}
