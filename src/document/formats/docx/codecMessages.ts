import type { JSONContent } from '@tiptap/core'
import type { DocxIssue } from './model'

export type DocxWorkerRequest = { operation: 'read'; bytes: Uint8Array<ArrayBuffer> } | { operation: 'write'; document: JSONContent }
export type DocxWorkerReply = { operation: 'read'; document: JSONContent; issues: DocxIssue[] } |
  { operation: 'write'; bytes: Uint8Array<ArrayBuffer> } | { operation: 'error'; message: string }
