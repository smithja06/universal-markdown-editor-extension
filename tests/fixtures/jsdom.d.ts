// The subset of jsdom used by Node-environment unit tests. jsdom ships without bundled types.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    readonly window: Window & typeof globalThis
  }
}
