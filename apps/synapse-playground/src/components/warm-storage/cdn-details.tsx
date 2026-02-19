import { useEgressQuota } from '@filoz/synapse-react'
import { Globe } from 'lucide-react'
import { formatBytes } from '@/lib/utils.ts'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx'

export function CdnDetails({ dataSetId }: { dataSetId: bigint }) {
  const { data: egressQuota } = useEgressQuota({ dataSetId })

  return (
    <span className="flex items-center gap-1 text-sm text-muted-foreground">
      <Tooltip>
        <TooltipTrigger>
          <Globe className="w-4" />
        </TooltipTrigger>
        <TooltipContent>
          <p>This data set is using CDN</p>
        </TooltipContent>
      </Tooltip>
      {egressQuota && (
        <>
          Egress remaining: {formatBytes(egressQuota.cdnEgressQuota)} delivery{' · '}
          {formatBytes(egressQuota.cacheMissEgressQuota)} cache-miss
        </>
      )}
    </span>
  )
}
