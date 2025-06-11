/**
 * A labeled location with an optional stack representing a
 * specific point in execution.
 * Location provides context for errors or logs, indicating where
 * an effect or operation is occurring. Locations can be chained
 * to form a path through the code, including through async operations.
 */
export interface Location {
  readonly label: string
  readonly stack?: string
}

/**
 * Create a Location, optionally extending an existing one.
 */
export const label = (label: string, origin?: Location): Location =>
  new LocationWithStack(origin ? `${origin.label}/${label}` : label, { cause: origin })

class LocationWithStack extends Error implements Location {
  constructor(readonly label: string, options?: { readonly cause?: Location }) {
    super(label, options)
  }
}
