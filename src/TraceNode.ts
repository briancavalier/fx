import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DiagnosticSourceLookup } from './Trace.js'

export const nodeSourceLookup = (): DiagnosticSourceLookup => {
  const cache = new Map<string, string>()

  return location => {
    if (location.file === undefined) return undefined

    const path = resolveSourcePath(location.file)
    if (path === undefined) return undefined

    const cached = cache.get(path)
    if (cached !== undefined) return cached

    try {
      const source = readFileSync(path, 'utf8')
      cache.set(path, source)
      return source
    } catch {
      return undefined
    }
  }
}

const resolveSourcePath = (file: string): string | undefined => {
  try {
    if (file.startsWith('file://')) return fileURLToPath(file)
    if (hasScheme(file)) return undefined
    return isAbsolute(file) ? file : resolve(file)
  } catch {
    return undefined
  }
}

const hasScheme = (file: string): boolean =>
  /^[A-Za-z][A-Za-z\d+.-]*:/.test(file)
