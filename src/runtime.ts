import { defaultConsole } from "./Console.js"
import { defaultRandom } from "./Random.js"
import { defaultTime } from "./Time.js"
import { generateSeed } from "./internal/random.js"

export const defaultRuntime = [
  defaultTime,
  defaultConsole,
  defaultRandom(generateSeed()),
] as const
