import { useEffect, useRef, useState } from 'react'
import type { OriginalFileReference } from '../../document/formats/content'
import { originalFileBytes } from '../../document/formats/registry'

/** Reads the immutable original of a standalone PDF document from browser storage. */
export function usePdfOriginal(reference: OriginalFileReference | undefined, readOriginal: (id: string) => Promise<Blob | undefined>) {
  const [state, setState] = useState<{ id: string; bytes?: Uint8Array; error?: string }>()
  const current = useRef(reference)
  current.current = reference
  const id = reference?.id
  useEffect(() => {
    const target = current.current
    if (!id || !target) { setState(undefined); return }
    let active = true
    setState({ id })
    originalFileBytes(target, readOriginal).then(
      bytes => { if (active) setState({ id, bytes }) },
      () => { if (active) setState({ id, error: 'The original PDF is unavailable in browser storage.' }) },
    )
    return () => { active = false }
  }, [id, readOriginal])
  return state?.id === id ? state : undefined
}
