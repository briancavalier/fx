import { capturesStack } from './internal/runtimeContext.js'

/**
 * A labeled annotation with an optional stack representing a
 * specific point in execution.
 * Breadcrumb provides context for errors or logs, indicating where
 * an effect or operation is occurring. Breadcrumbs can be chained
 * to form a path through the code, including through async operations.
 */
export interface Breadcrumb {
  readonly message: string
  readonly stack?: string
}

/**
 * Capture a Breadcrumb with the provided message.
 */
export const at: (message: string, f?: Function) => Breadcrumb = (message, f = at) =>
  capturesStack() ? new BreadcrumbAt(message, f) : { message }

/**
 * Derive an indexed Breadcrumb from an existing Breadcrumb while preserving the
 * original stack frames.
 */
export const indexed = (origin: Breadcrumb, index: number): Breadcrumb => {
  const message = `${origin.message}[${index}]`

  return {
    message,
    get stack() {
      return replaceStackMessage(origin.stack, origin.message, message)
    }
  }
}

class BreadcrumbAt extends Error implements Breadcrumb {
  constructor(
    public readonly message: string,
    f: Function,
    options?: ErrorOptions
  ) {
    super(message, options)
    if (Error.captureStackTrace) Error.captureStackTrace(this, f)
  }
}

const replaceStackMessage = (stack: string | undefined, current: string, next: string) => {
  if (stack === undefined) return undefined

  const lineEnd = stack.indexOf('\n')
  const firstLine = lineEnd === -1 ? stack : stack.slice(0, lineEnd)
  const rest = lineEnd === -1 ? '' : stack.slice(lineEnd)
  const replaced = firstLine.includes(current)
    ? firstLine.replace(current, next)
    : next

  return `${replaced}${rest}`
}
