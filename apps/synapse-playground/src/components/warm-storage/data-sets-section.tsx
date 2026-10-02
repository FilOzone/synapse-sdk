import type { DataSetWithPieces, UseProvidersResult } from '@filoz/synapse-react'
import { useDeletePiece } from '@filoz/synapse-react'
import { CloudDownload, File, Globe, Info, Trash } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { toastError } from '@/lib/utils.ts'
import { ButtonLoading } from '../custom-ui/button-loading.tsx'
import { ExplorerLink } from '../explorer-link.tsx'
import { PDPDatasetLink, PDPPieceLink, PDPProviderLink } from '../pdp-link.tsx'
import { Button } from '../ui/button.tsx'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '../ui/item.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx'
import { CreateDataSetDialog } from './create-data-set.tsx'

export function DataSetsSection({
  dataSets,
  providers,
}: {
  dataSets?: DataSetWithPieces[]
  providers?: UseProvidersResult
}) {
  const providerWithDataSets = providers?.filter((p) => dataSets?.some((d) => d.providerId === p.id))

  const [deletingPiece, setDeletingPiece] = useState<bigint | null>(null)
  const { mutate: deletePiece, isPending: isDeletingPiece } = useDeletePiece({
    onHash: (hash) => {
      toast.loading('Deleting piece...', {
        description: <ExplorerLink hash={hash} />,
        id: 'delete-piece',
      })
    },
    mutation: {
      onSuccess: () => {
        toast.success('Piece deleted', {
          id: 'delete-piece',
        })
      },
      onError: (error) => {
        toastError(error, 'delete-piece', 'Piece deletion failed')
      },
      onSettled: () => {
        setDeletingPiece(null)
      },
    },
  })

  return providers ? (
    <div>
      <div className="flex flex-row gap-2 items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="leading-none font-semibold">Data Sets</div>
          <div className="text-muted-foreground text-sm">Manage your data sets.</div>
        </div>
        <CreateDataSetDialog />
      </div>

      <div className="flex flex-col gap-2 mt-6">
        {providerWithDataSets?.map((provider) => (
          <div className="flex flex-col gap-4" key={provider.id}>
            <h4 className="text-lg font-bold">
              <PDPProviderLink address={provider.serviceProvider} name={provider.name} />
            </h4>
            {dataSets
              ?.filter((dataSet) => dataSet.providerId === provider.id)
              .map((dataSet) => (
                <div className="flex flex-col gap-2" key={dataSet.clientDataSetId}>
                  <p className="flex flex-row gap-2 items-center">
                    <PDPDatasetLink id={dataSet.dataSetId.toString()} />
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="w-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Files: {dataSet.pieces.length}</p>
                        {Object.keys(dataSet.metadata).map((key) => (
                          <p key={key}>
                            {key.charAt(0).toUpperCase() + key.slice(1)}: {dataSet.metadata[key]}
                          </p>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                    {dataSet.cdn && (
                      <Tooltip>
                        <TooltipTrigger>
                          <Globe className="w-4" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>This data set is using CDN</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </p>

                  {dataSet.pieces.map((piece) => (
                    <Item key={`${piece.id}-${dataSet.dataSetId}`} size="default" variant="muted">
                      <ItemMedia variant="icon">
                        <File className="w-10" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="break-all">
                          <PDPPieceLink cid={piece.cid.toString()} />
                        </ItemTitle>
                        <ItemDescription>Piece #{piece.id.toString()}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          disabled={piece.url == null}
                          onClick={() => {
                            if (piece.url != null) window.open(piece.url, '_blank')
                          }}
                        >
                          <CloudDownload />
                        </Button>
                        <ButtonLoading
                          disabled={dataSet.provider == null}
                          loading={isDeletingPiece && deletingPiece === piece.id}
                          onClick={async () => {
                            setDeletingPiece(piece.id)
                            deletePiece({
                              dataSet,
                              pieceId: piece.id,
                            })
                          }}
                        >
                          <Trash />
                        </ButtonLoading>
                      </ItemActions>
                    </Item>
                  ))}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  ) : (
    <Skeleton className="w-full h-20" />
  )
}
