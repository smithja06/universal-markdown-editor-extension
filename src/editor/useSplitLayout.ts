import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export const minimumPaneWidth = 300
export const dividerWidth = 9

export function splitLimits(width: number) {
  const available = width - dividerWidth
  if (available < minimumPaneWidth * 2) return { min: 0.5, max: 0.5, stacked: true }
  const min = Math.max(0.2, minimumPaneWidth / available)
  return { min, max: 1 - min, stacked: false }
}

export function useSplitLayout(preferred: number, onResize: (value: number) => void) {
  const container = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)
  const draft = useRef<number | null>(null)
  const grabOffset = useRef(0)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const limits = splitLimits(width)
  const clamp = (value: number) => Math.min(limits.max, Math.max(limits.min, Number.isFinite(value) ? value : 0.5))
  const ratio = clamp(dragging ?? preferred)
  return {
    container,
    ratio,
    stacked: limits.stacked,
    dragging: dragging !== null,
    separator: {
      'aria-valuemin': Math.round(limits.min * 100),
      'aria-valuemax': Math.round(limits.max * 100),
      'aria-valuenow': Math.round(ratio * 100),
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const step = event.shiftKey ? 0.1 : 0.025
        const choices: Record<string, number> = { ArrowLeft: ratio - step, ArrowRight: ratio + step, Home: limits.min, End: limits.max }
        const next = choices[event.key]
        if (typeof next !== 'number') return
        event.preventDefault()
        onResize(clamp(next))
      },
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || limits.stacked) return
        const rect = event.currentTarget.getBoundingClientRect()
        grabOffset.current = event.clientX - rect.left
        event.currentTarget.setPointerCapture(event.pointerId)
        draft.current = ratio
        setDragging(ratio)
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (draft.current === null || !event.currentTarget.hasPointerCapture(event.pointerId) || !container.current) return
        const bounds = container.current.getBoundingClientRect()
        draft.current = clamp((event.clientX - bounds.left - grabOffset.current) / (width - dividerWidth))
        setDragging(draft.current)
      },
      onDoubleClick() { onResize(0.5) },
      onLostPointerCapture() {
        if (draft.current !== null) onResize(draft.current)
        draft.current = null
        setDragging(null)
      },
      onPointerCancel() {
        draft.current = null
        setDragging(null)
      },
    },
  }
}
