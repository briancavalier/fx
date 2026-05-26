export interface ForkRuntime {
  readonly defaultEnv: Record<PropertyKey, unknown>
}

let activeForkRuntime: ForkRuntime | undefined

export const createForkRuntime = (): ForkRuntime => ({ defaultEnv: {} })

export const currentForkRuntime = (): ForkRuntime | undefined =>
  activeForkRuntime

export const withActiveForkRuntime = <A>(forkRuntime: ForkRuntime, f: () => A): A => {
  const previous = activeForkRuntime
  activeForkRuntime = forkRuntime
  try {
    return f()
  } finally {
    activeForkRuntime = previous
  }
}
