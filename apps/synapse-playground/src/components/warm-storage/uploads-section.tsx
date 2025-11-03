import { type DataSetWithPieces, type UseProvidersResult, useUpload } from '@filoz/synapse-react'
import { useEffect, useState } from 'react'
import { ErrorAlert, HashAlert } from '../custom-ui/alerts.tsx'
import { ButtonLoading } from '../custom-ui/button-loading.tsx'
import { Label } from '../ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { UploadsZone } from './uploads-zone.tsx'

export function UploadsSection({
  dataSets,
  providers,
}: {
  dataSets?: DataSetWithPieces[]
  providers?: UseProvidersResult
}) {
  const [hash, setHash] = useState<string | null>(null)
  const [dataSet, setDataSet] = useState<string | undefined>(undefined)
  const [files, setFiles] = useState<File[] | undefined>()

  const providerWithDataSets = providers?.map((provider) => ({
    ...provider,
    dataSets: dataSets?.filter((d) => d.providerId === provider.id),
  }))

  useEffect(() => {
    if (!dataSet && dataSets && dataSets.length > 0) {
      setDataSet(dataSets[0].dataSetId.toString())
    }
  }, [dataSets, dataSet])

  const {
    mutate: upload,
    isPending: isUploading,
    error: uploadError,
  } = useUpload({
    onHash: (hash) => {
      setHash(hash)
    },
    mutation: {
      onSettled: () => {
        setHash(null)
        setFiles(undefined)
      },
    },
  })

  const handleDrop = (files: File[]) => {
    setFiles(files)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (files && files.length > 0 && dataSet) {
      // upload({
      //   files: Array.from(fileInput.files),
      //   dataSetId,
      //   sessionKey: sessionKey,
      // })
      upload({ files: Array.from(files), dataSetId: BigInt(dataSet) })
    }
  }

  return dataSet ? (
    <form onSubmit={onSubmit}>
      <div className="flex flex-col gap-3 my-4">
        <Label htmlFor="data-set">Data Set</Label>
        <Select
          name="data-set"
          onValueChange={(value) => {
            setDataSet(value)
          }}
          value={dataSet}
        >
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select a data set" />
          </SelectTrigger>
          <SelectContent>
            {providerWithDataSets?.map((provider) => (
              <SelectGroup key={provider.id}>
                <SelectLabel>{provider.name}</SelectLabel>
                {provider.dataSets?.map((dataSet) => (
                  <SelectItem key={dataSet.dataSetId} value={dataSet.dataSetId.toString()}>
                    # {dataSet.dataSetId} {dataSet.cdn ? 'CDN' : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <UploadsZone files={files} handleDrop={handleDrop} />
        <ButtonLoading disabled={!dataSet} loading={isUploading} type="submit">
          Upload
        </ButtonLoading>

        <ErrorAlert error={uploadError} />
        <HashAlert hash={hash} />
      </div>
    </form>
  ) : (
    <Skeleton className="w-full h-50" />
  )
}
