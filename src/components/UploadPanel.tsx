import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { FileUp, LoaderCircle } from 'lucide-react'

import { ACCEPTED, ACCEPTED_LABEL, MAX_UPLOAD_BYTES, formatBytes } from '../lib/aegis'
import { cx } from '../lib/cx'
import { Button } from './Button'

const ALLOWED = ['.pdf', '.docx', '.txt', '.md']

/** Drop or browse for a policy file; validates type and size before upload. */
export function UploadPanel({ onFile, busy, error }: { onFile: (file: File) => void; busy?: boolean; error?: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [local, setLocal] = useState<string | null>(null)

  const accept = (file: File | undefined) => {
    if (!file) return
    const suffix = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
    if (!ALLOWED.includes(suffix)) {
      setLocal(`That is a ${suffix || 'unknown'} file. Upload ${ACCEPTED_LABEL}.`)
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocal(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`)
      return
    }
    setLocal(null)
    onFile(file)
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files?.[0])
  }

  const message = local ?? error

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={cx(
        'relative flex flex-col items-center justify-center gap-4 rounded-[24px] border border-dashed px-6 py-14 text-center transition-colors duration-200',
        dragging ? 'border-fire-2 bg-fire-1/10' : 'border-white/15 bg-white/[0.02]',
      )}
    >
      <span className="relative grid size-14 place-items-center rounded-[18px] bg-white/[0.06] text-white/70">
        {busy ? <LoaderCircle className="size-6 animate-spin" aria-hidden /> : <FileUp className="size-6" aria-hidden />}
      </span>
      <div className="space-y-1.5">
        <p className="text-[17px] font-medium text-white">{busy ? 'Uploading and queuing the audit…' : 'Drop a policy document'}</p>
        <p className="mx-auto max-w-[420px] text-pretty text-[14px] leading-relaxed text-muted">
          {ACCEPTED_LABEL}, up to {formatBytes(MAX_UPLOAD_BYTES)}. Text is extracted locally; only the audit call leaves this machine.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={busy}>
        Choose a file
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        onChange={(event) => {
          accept(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {message ? (
        <p role="alert" className="max-w-[440px] text-[13px] text-danger">
          {message}
        </p>
      ) : null}
    </div>
  )
}
