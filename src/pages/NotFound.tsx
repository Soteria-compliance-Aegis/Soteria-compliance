import { ArrowLeft } from 'lucide-react'

import { ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Eyebrow } from '../components/Typography'

export function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[620px] items-center px-6">
      <Card tone="plain" className="w-full p-8 sm:p-10">
        <Eyebrow tone="fire">404</Eyebrow>
        <h1 className="display mt-3 text-[34px]">Nothing on record here.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          The workspace has the overview, the document library and individual audits — nothing else.
        </p>
        <div className="mt-6">
          <ButtonLink href="/" variant="secondary">
            <ArrowLeft className="size-4" aria-hidden />
            Back to the overview
          </ButtonLink>
        </div>
      </Card>
    </div>
  )
}
