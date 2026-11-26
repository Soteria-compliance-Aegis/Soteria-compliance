import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

/*
  Surfaces. Every card is a lit squircle; `tone` picks its light:
  - plain: near-black glass, for lists and forms
  - fire: ember to clay, the heat of a gap
  - ocean: coal lifting into deep blue
  - stripes: blue light through vertical slats (the stat card)
  - steel: cool grey, for neutral media
*/
export type CardTone = 'plain' | 'fire' | 'ocean' | 'stripes' | 'steel'

const tones: Record<CardTone, string> = {
  plain: 'bg-surface',
  fire: 'bg-[radial-gradient(120%_85%_at_50%_100%,#eab594_0%,#cf8054_26%,#8f4a2c_52%,#2c150b_82%,#120a06_100%)]',
  ocean: 'bg-[radial-gradient(120%_90%_at_50%_100%,#5b7ede_0%,#2b4791_38%,#141d33_72%,#080a10_100%)]',
  stripes:
    'bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0)_0_7px,rgb(190_208_245/0.12)_7px_9px),radial-gradient(90%_70%_at_50%_15%,#3b5bb0_0%,#22335c_45%,#0d1220_100%)]',
  steel: 'bg-[linear-gradient(160deg,#242a34_0%,#101319_100%)]',
}

export function Card({
  tone = 'plain',
  children,
  className,
  as: As = 'div',
  interactive = false,
  id,
}: {
  id?: string
  tone?: CardTone
  children: ReactNode
  className?: string
  as?: 'div' | 'article' | 'li' | 'section'
  interactive?: boolean
}) {
  return (
    <As
      id={id}
      className={cx(
        'depth relative isolate overflow-hidden rounded-[18px]',
        tones[tone],
        interactive && 'transition-transform duration-300 ease-out hover:-translate-y-1',
        className,
      )}
    >
      {children}
    </As>
  )
}

/** The text block that sits at the top of a feature card. */
export function CardText({ title, body, className }: { title: ReactNode; body: ReactNode; className?: string }) {
  return (
    <div className={cx('relative z-10 flex flex-col gap-1 p-5 sm:p-6', className)}>
      <h3 className="text-[16px] font-medium text-white">{title}</h3>
      <p className="text-pretty text-[16px] leading-[1.42] text-white/85">{body}</p>
    </div>
  )
}
