import { Effect } from './Effect'
import { Fx, control, fx, ok } from './Fx'

export class Fail<const E> extends Effect('fx/Fail')<E, never> { }

export const fail = <const E>(e: E): Fx<Fail<E>, never> => new Fail(e)

export const catchOnly = <const F>(match: (x: unknown) => x is F) =>
  <const E, const A>(f: Fx<E, A>) =>
    f.pipe(
      control(Fail, (resume, e) => fx(function* () {
        return match(e) ? e : resume(yield* fail(e))
      }))
    ) as Fx<Exclude<E, Fail<F>>, A | UnwrapFail<Extract<E, Fail<F>>>>

export const catchAll = <const E, const A>(f: Fx<E, A>) =>
  f.pipe(
    control(Fail, (_, e) => ok(e))
  ) as Fx<Exclude<E, Fail<any>>, A | UnwrapFail<Extract<E, Fail<E>>>>

export const catchFail = <const E, const A>(f: Fx<E, A>) =>
  f.pipe(
    control(Fail, (_, e) => ok(new Fail(e)))
  ) as Fx<Exclude<E, Fail<any>>, A | Extract<E, Fail<any>>>

export const orElse = <const B>(b: B) => <const E, const A>(f: Fx<E, A>) =>
  f.pipe(
    control(Fail, _ => ok(b))
  ) as Fx<Exclude<E, Fail<any>>, A | B>

type UnwrapFail<F> = F extends Fail<infer E> ? E : never
