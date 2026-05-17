import { Async } from './Async.js'
import { Effect } from './Effect.js'
import { Get, provide, provideFrom, type ExcludeEnv } from './Env.js'
import { Fail } from './Fail.js'
import { Fx, flatMap, ok } from './Fx.js'
import { HandlerCapture, captureHandlers, type CapturedHandler } from './HandlerCapture.js'
import { type Headers, type Method } from './HttpClient.js'

/**
 * A transport-neutral HTTP server request.
 */
export type ServerRequest<Params extends ParamsRecord = ParamsRecord> = {
  readonly method: Method
  readonly url: URL
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Headers
  readonly body: ReadableStream<Uint8Array>
  readonly params: Params
}

/**
 * A transport-neutral HTTP server response.
 */
export type ServerResponse<E = never> = {
  readonly status: number
  readonly headers?: Headers
  readonly body?: ResponseBody<E>
}

export type ServerEvent =
  | ServerListening
  | ServerRequestCompleted
  | ServerRequestFailed
  | ServerClosed

export type ServerAddress = {
  readonly host: string
  readonly port: number
}

export type ServerListening = {
  readonly type: 'listening'
  readonly timestamp: number
  readonly address: ServerAddress | null
}

export type ServerRequestCompleted = {
  readonly type: 'request'
  readonly timestamp: number
  readonly method: Method
  readonly path: string
  readonly status: number
  readonly durationMs: number
}

export type ServerRequestFailed = {
  readonly type: 'requestFailed'
  readonly timestamp: number
  readonly method: Method
  readonly path: string
  readonly status: number
  readonly durationMs: number
  readonly error: unknown
}

export type ServerClosed = {
  readonly type: 'closed'
  readonly timestamp: number
}

export type ResponseBody<_E = never> =
  | { readonly type: 'empty' }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'json'; readonly value: unknown }
  | { readonly type: 'bytes'; readonly value: Uint8Array }
  | { readonly type: 'stream'; readonly value: ReadableStream<Uint8Array> }

export type ParamsRecord = Readonly<Record<string, string>>

export type RouteContext<Params extends ParamsRecord = ParamsRecord> = {
  readonly request: ServerRequest<Params>
}

export type RouteEffects<E> =
  ExcludeEnv<E, RouteContext<any>>

export type RouteHandler<E, Params extends ParamsRecord = ParamsRecord> =
  Fx<E | Get<RouteContext<Params>>, ServerResponse<E>>

/**
 * A composable HTTP route declaration tree.
 */
export type Routes<E = never> =
  | EmptyRoutes
  | SingleRoute<E>
  | ConcatRoutes<E>
  | MountedRoutes<E>
  | TransformedRoutes<any, E>

export type EmptyRoutes = {
  readonly type: 'empty'
}

export type SingleRoute<E> = {
  readonly type: 'route'
  readonly route: Route<E>
}

export type ConcatRoutes<E> = {
  readonly type: 'concat'
  readonly routes: readonly Routes<E>[]
}

export type MountedRoutes<E> = {
  readonly type: 'mount'
  readonly prefix: string
  readonly routes: Routes<E>
}

export type TransformedRoutes<E1, E2> = {
  readonly type: 'transform'
  readonly routes: Routes<E1>
  readonly transform: RouteTransform<E1, E2>
}

export type Route<E, Params extends ParamsRecord = ParamsRecord> = {
  readonly method: Method
  readonly path: string
  readonly handle: RouteHandler<E, Params>
}

export const emptyRoutes: Routes<never> = { type: 'empty' }

export const route = <E>(
  method: Method,
  path: string,
  handle: Fx<E, ServerResponse<any>>
): SingleRoute<RouteEffects<E>> => ({
  type: 'route',
  route: {
    method,
    path,
    handle: handle as unknown as RouteHandler<RouteEffects<E>>
  }
})

type RouteList<Rs extends readonly unknown[]> = {
  readonly [K in keyof Rs]: Routes<unknown>
}

export const routes = <const Rs extends readonly unknown[]>(
  ...routes: Rs & RouteList<Rs>
): ConcatRoutes<EffectsOfRoutes<Rs[number]>> => ({
  type: 'concat',
  routes: routes as readonly Routes<EffectsOfRoutes<Rs[number]>>[]
})

export const mount = <E>(
  prefix: string,
  routes: Routes<E>
): MountedRoutes<E> => ({
  type: 'mount',
  prefix,
  routes
})

export type EffectsOfRoutes<R> =
  R extends SingleRoute<infer E> ? E
  : R extends ConcatRoutes<infer E> ? E
  : R extends MountedRoutes<infer E> ? E
  : R extends TransformedRoutes<any, infer E> ? E
  : never

export type RouteTransform<E1, E2> = {
  transform<A>(fx: Fx<E1 | Get<RouteContext<any>>, A>): Fx<E2 | Get<RouteContext<any>>, A>
}['transform']

export const transformRoutes = <E1, E2>(
  transform: RouteTransform<E1, E2>
) =>
  (routes: Routes<E1>): TransformedRoutes<E1, E2> => ({
    type: 'transform',
    routes,
    transform
  })

export const provideRoutesFrom =
  <const PE, const C extends Record<PropertyKey, unknown>>(context: Fx<PE, C>) =>
    transformRoutes(provideFrom(context)) as
      <const E>(routes: Routes<E>) => Routes<RouteEffects<PE | ExcludeEnv<E, C>>>

export type ServerRouteEffects = Async | Fail<any> | HandlerCapture<string>

export const ServeScope = 'fx/HttpServer/Serve'

/**
 * Request that an HTTP server run the provided routes.
 */
export class Serve<const E = never, const OE = never> extends Effect('fx/HttpServer/Serve')<ServeRequest<E, OE>, void> { }

export type ServeRequest<E = never, OE = never> = {
  readonly routes: Routes<E>
  readonly options: ServeOptions<OE>
  readonly context: readonly CapturedHandler[]
}

export type ServeOptions<OE = never> = {
  readonly port: number
  readonly host?: string
  readonly observe?: (event: ServerEvent) => Fx<OE, void>
}

export const serve = <E, OE = never>(
  routes: Routes<E>,
  options: ServeOptions<OE>
): Fx<Exclude<E, ServerRouteEffects> | OE | Serve<E, OE> | HandlerCapture<typeof ServeScope>, void> =>
  captureHandlers(ServeScope).pipe(
    flatMap(context => new Serve<E, OE>({ routes, options, context }))
  )

export type CompiledRoutes<E> = {
  readonly routes: readonly CompiledRoute<E>[]
}

export type CompiledRoute<E> = {
  readonly method: Method
  readonly path: string
  readonly match: PathMatcher
  readonly handle: RouteHandler<E>
}

export type PathMatcher = (path: string) => false | ParamsRecord

export const compileRoutes = <E>(routes: Routes<E>): CompiledRoutes<E> => ({
  routes: compile(routes, '', [])
})

export const dispatch = <E>(
  compiled: CompiledRoutes<E>,
  request: ServerRequest
): Fx<E, ServerResponse<E>> => {
  for (const route of compiled.routes) {
    if (route.method !== request.method) continue

    const params = route.match(request.path)
    if (params !== false) return route.handle.pipe(
      provide({ request: { ...request, params } })
    ) as Fx<E, ServerResponse<E>>
  }

  return ok({
    status: 404,
    headers: [['content-type', 'text/plain; charset=utf-8']],
    body: { type: 'text', value: 'Not Found' }
  })
}

const compile = <E>(
  routes: Routes<E>,
  prefix: string,
  transforms: readonly RouteTransform<any, any>[]
): readonly CompiledRoute<E>[] => {
  switch (routes.type) {
    case 'empty':
      return []

    case 'route': {
      const path = joinPaths(prefix, routes.route.path)
      return [{
        method: routes.route.method,
        path,
        match: compilePath(path),
        handle: applyRouteTransforms(routes.route.handle, transforms)
      }]
    }

    case 'concat':
      return routes.routes.flatMap(r => compile(r, prefix, transforms))

    case 'mount':
      return compile(routes.routes, joinPaths(prefix, routes.prefix), transforms)

    case 'transform':
      return compile(routes.routes, prefix, [...transforms, routes.transform]) as readonly CompiledRoute<E>[]
  }
}

const applyRouteTransforms = <E>(
  handle: RouteHandler<E>,
  transforms: readonly RouteTransform<any, any>[]
): RouteHandler<E> =>
  transforms.reduceRight(
    (handle, transform) => transform(handle),
    handle as Fx<unknown, ServerResponse<unknown>>
  ) as RouteHandler<E>

const joinPaths = (prefix: string, path: string): string => {
  const p1 = trimSlashes(prefix)
  const p2 = trimSlashes(path)
  if (p1 === '' && p2 === '') return '/'
  if (p1 === '') return `/${p2}`
  if (p2 === '') return `/${p1}`
  return `/${p1}/${p2}`
}

const trimSlashes = (path: string): string =>
  path.replace(/^\/+|\/+$/g, '')

const compilePath = (path: string): PathMatcher => {
  const parts = splitPath(path)

  return candidate => {
    const candidateParts = splitPath(candidate)
    const params: Record<string, string> = {}

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]

      if (part === '*') {
        params['*'] = candidateParts.slice(i).map(decodePathPart).join('/')
        return params
      }

      if (i >= candidateParts.length) return false

      if (part.startsWith(':')) {
        params[part.slice(1)] = decodePathPart(candidateParts[i])
      } else if (part !== candidateParts[i]) {
        return false
      }
    }

    return candidateParts.length === parts.length ? params : false
  }
}

const splitPath = (path: string): readonly string[] =>
  trimSlashes(path).split('/').filter(Boolean)

const decodePathPart = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}
