import type { DataSetWithPieces, UseProvidersResult } from '@filoz/synapse-react'
import { CloudDownload, FileAudio, FileCode, FilePlay, FileText, Globe, Info } from 'lucide-react'
import { PDPDatasetLink, PDPPieceLink, PDPProviderLink } from '../pdp-link.tsx'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar.tsx'
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
  const providerWithDataSets = providers?.filter((p) => dataSets?.some((d) => d.providerId === p.providerId))

  const imagesMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const videosMimeTypes = ['video/mp4', 'video/quicktime', 'video/webm']
  const audioMimeTypes = ['audio/mpeg', 'audio/ogg', 'audio/wav']
  const documentsMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/svg+xml',
    'text/markdown',
  ]
  const codeMimeTypes = [
    'text/plain',
    'text/html',
    'text/css',
    'text/javascript',
    'application/json',
    'application/xml',
    'application/x-www-form-urlencoded',
    'application/x-yaml',
    'application/x-toml',
    'application/x-ini',
    'application/x-toml',
  ]

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
          <div className="flex flex-col gap-4" key={provider.providerId}>
            <h4 className="text-lg font-bold">
              <PDPProviderLink address={provider.serviceProvider} name={provider.name} />
            </h4>
            {dataSets
              ?.filter((dataSet) => dataSet.providerId === provider.providerId)
              .map((dataSet) => (
                <div className="flex flex-col gap-2" key={dataSet.clientDataSetId}>
                  <p className="flex flex-row gap-2 items-center">
                    <PDPDatasetLink id={dataSet.pdpDatasetId.toString()} />
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
                    <Item key={`${piece.pieceId}-${dataSet.pdpDatasetId}`} size="default" variant="muted">
                      <ItemMedia
                        variant={
                          imagesMimeTypes.includes(piece.metadata.type)
                            ? 'image'
                            : piece.metadata.type
                              ? 'icon'
                              : 'default'
                        }
                      >
                        {imagesMimeTypes.includes(piece.metadata.type) ? (
                          <img
                            alt={piece.metadata.name || piece.pieceCid}
                            className="object-cover"
                            height={48}
                            src={piece.pieceUrl}
                            width={48}
                          />
                        ) : videosMimeTypes.includes(piece.metadata.type) ? (
                          <FilePlay className="w-10" />
                        ) : audioMimeTypes.includes(piece.metadata.type) ? (
                          <FileAudio className="w-10" />
                        ) : documentsMimeTypes.includes(piece.metadata.type) ? (
                          <FileText className="w-10" />
                        ) : codeMimeTypes.includes(piece.metadata.type) ? (
                          <FileCode className="w-10" />
                        ) : (
                          <Avatar className="size-10">
                            <AvatarImage src={piece.pieceUrl} />
                            <AvatarFallback>NA</AvatarFallback>
                          </Avatar>
                        )}
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="break-all">
                          <PDPPieceLink cid={piece.pieceCid} name={piece.metadata.name} />
                        </ItemTitle>
                        <ItemDescription>{piece.metadata.type}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          onClick={() => {
                            window.open(piece.pieceUrl, '_blank')
                          }}
                        >
                          <CloudDownload />
                        </Button>
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
