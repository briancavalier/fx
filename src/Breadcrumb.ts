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
 * Create a Breadcrumb, optionally linked to an existing one.
 */
export const at = (message: string, prev?: Breadcrumb): Breadcrumb =>
  new BreadcrumbAt(message, { cause: prev })

class BreadcrumbAt extends Error implements Breadcrumb {
  constructor(
    public readonly message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    if (Error.captureStackTrace) Error.captureStackTrace(this, at)
  }
}
