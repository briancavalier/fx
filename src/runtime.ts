import { defaultConsole } from "./Console"
import { defaultRandom } from "./Random"
import { defaultTime } from "./Time"
import { generateSeed } from "./internal/random"

export const defaultRuntime = [
  defaultTime,
  defaultConsole,
  defaultRandom(generateSeed()),
] as const
