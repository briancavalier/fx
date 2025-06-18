import { Effect } from './Effect'
import { Fx, handle, map, ok } from './Fx'

export class Get<E extends Record<PropertyKey, unknown>> extends Effect('fx/Env')<void, E> { }

export const get = <const E extends Record<PropertyKey, unknown>>() =>
  new Get<E>()

type ExcludeEnv<E, S> =
  E extends Get<Record<PropertyKey, unknown>>
  ? S extends E['R'] ? never
  : S extends Record<PropertyKey, unknown>
  ? Get<{ readonly [K in keyof E['R']as S[K] extends E['R'][K] ? never : K]: E['R'][K] }>
  : E
  : E

export const provide = <const S extends Record<PropertyKey, unknown>>(s: S) => <const E, const A>(f: Fx<E, A>) =>
  f.pipe(
    handle(Get, _ => get().pipe(map(e => ({ ...e, ...s }))))
  ) as Fx<ExcludeEnv<E, S>, A>

export type EnvOf<E> = U2I<EachEnv<E>>
type EachEnv<E> = E extends Get<infer A> ? A : never

export const provideAll = <const S extends Record<PropertyKey, unknown>>(s: S) => <const E, const A>(f: Fx<CheckEnv<S, E>, A>) =>
  f.pipe(
    handle(Get, _ => ok(s))
  ) as Fx<ExcludeEnv<E, S>, A>

type U2I<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

type CheckEnv<S, E> = E extends Get<infer A> ? S extends A ? E
  : ['provideAll missing required elements', { readonly [K in Exclude<keyof A, keyof S>]: A[K] }]
  : E
