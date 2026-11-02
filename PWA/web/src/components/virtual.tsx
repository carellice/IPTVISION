import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

// LazyColumn / LazyVerticalGrid(GridCells.Adaptive): only the rows on screen exist, so "Tutti"
// with 50.000 films scrolls like on the phone. Items have a fixed height per layout.

export function VirtualGrid({
  count, minCell, gap, rowGap = gap, padding, rowHeight, render, initialIndex = 0, columns: fixedColumns, keyOf,
}: {
  count: number
  /** GridCells.Adaptive(minCell); omit for a single column list. */
  minCell?: number
  gap: number
  rowGap?: number
  padding: [number, number]
  /** Height of a row given the width of a cell. */
  rowHeight: (cellWidth: number) => number
  render: (index: number, cellWidth: number) => ReactNode
  initialIndex?: number
  columns?: number
  keyOf: (index: number) => string | number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [scroll, setScroll] = useState(0)
  const scrolled = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth); setHeight(el.clientHeight) })
    ro.observe(el)
    setWidth(el.clientWidth)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const [ph, pv] = padding
  const inner = Math.max(0, width - 2 * ph)
  const columns = fixedColumns ?? (minCell ? Math.max(1, Math.floor((inner + gap) / (minCell + gap))) : 1)
  const cell = columns > 0 ? (inner - gap * (columns - 1)) / columns : inner
  const rh = rowHeight(cell)
  const rows = Math.ceil(count / columns)
  const total = rows > 0 ? 2 * pv + rows * rh + (rows - 1) * rowGap : 0

  // The list opens on the item the user came from (the channel playing, the last category).
  useLayoutEffect(() => {
    if (scrolled.current || width === 0 || !ref.current) return
    scrolled.current = true
    const row = Math.floor(initialIndex / columns)
    if (row > 0) ref.current.scrollTop = pv + row * (rh + rowGap)
  }, [width, columns, rh, rowGap, pv, initialIndex])

  const first = Math.max(0, Math.floor((scroll - pv) / (rh + rowGap)) - 3)
  const last = Math.min(rows - 1, Math.ceil((scroll + height - pv) / (rh + rowGap)) + 3)
  const items: ReactNode[] = []
  if (width > 0) {
    for (let r = first; r <= last; r++) {
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c
        if (i >= count) break
        items.push(
          <div key={keyOf(i)} style={{ position: 'absolute', top: pv + r * (rh + rowGap), left: ph + c * (cell + gap), width: cell, height: rh }}>
            {render(i, cell)}
          </div>,
        )
      }
    }
  }
  return (
    <div ref={ref} className="scroll" style={{ flex: 1, height: '100%', position: 'relative', overflowX: 'hidden' }}
      onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}>
      <div style={{ height: total, position: 'relative' }}>{items}</div>
    </div>
  )
}
