import type { FileOperations } from './contracts'

export const downloadFile: FileOperations['download'] = (filename, data, mediaType) => {
  const url = URL.createObjectURL(new Blob([data], { type: mediaType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
