/**
 * A labeled annotation with an optional stack representing a
 * specific point in execution.
 * Annotation provides context for errors or logs, indicating where
 * an effect or operation is occurring. Annotations can be chained
 * to form a path through the code, including through async operations.
 */
export interface Breadcrumb {
  readonly message: string
  readonly stack?: string
}

/**
 * Create an Annotation, optionally linked to another existing one.
 */
export const at = (message: string, prev?: Breadcrumb): Breadcrumb =>
  new Error(message, { cause: prev })
