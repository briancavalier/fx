import { defaultConsole } from "./Console.js";
import { defaultRandom } from "./Random.js";
import { defaultTime } from "./Time.js";
export const defaultRuntime = [
    defaultTime,
    defaultConsole,
    defaultRandom(),
];
