import { Effect } from './Effect.js';
import { flatMap, map, ok } from './Fx.js';
import { handle } from './Handler.js';
export class Get extends Effect('fx/Env') {
}
export const get = () => new Get();
export const provide = (s) => (f) => f.pipe(handle(Get, _ => get().pipe(map(e => ({ ...e, ...s })))));
export const provideFrom = (context) => (f) => context.pipe(flatMap(c => f.pipe(provide(c))));
export const provideAll = (s) => (f) => f.pipe(handle(Get, _ => ok(s)));
