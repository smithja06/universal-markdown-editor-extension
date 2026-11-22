// Only these shared actions may be dispatched by the VS Code workbench.
export const nativeCommands = {
  'folio.showVisual': 'view.mode.visual',
  'folio.showMarkdown': 'view.mode.source',
  'folio.showSplit': 'view.mode.split',
  'folio.toggleProperties': 'view.properties',
  'folio.goToHeading': 'navigation.headings',
  'folio.showCommands': 'workspace.palette',
} as const

export type NativeAction = typeof nativeCommands[keyof typeof nativeCommands]

export function isNativeAction(value: unknown): value is NativeAction {
  return typeof value === 'string' && Object.values(nativeCommands).some(action => action === value)
}
