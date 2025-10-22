'use client'

import { Dropzone, DropzoneContent, DropzoneEmptyState } from '@/components/kibo-ui/dropzone/index.tsx'
import { toastError } from '@/lib/utils.ts'

export function UploadsZone({ files, handleDrop }: { files: File[] | undefined; handleDrop: (files: File[]) => void }) {
  return (
    <Dropzone
      maxFiles={3}
      maxSize={1024 * 1024 * 200}
      onDrop={handleDrop}
      onError={(error) => {
        console.error(error)
        toastError(error, 'upload-error')
      }}
      src={files}
    >
      <DropzoneEmptyState />
      <DropzoneContent />
    </Dropzone>
  )
}
