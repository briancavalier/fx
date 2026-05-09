import { Async } from './Async.js'
import { Effect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, flatMap, ok } from './Fx.js'
import { type Headers, type Method } from './HttpClient.js'
import { Scoped, captureScoped, type HandlerContext } from './Scoped.js'

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

export type ResponseBody<_E = never> =
  | { readonly type: 'empty' }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'json'; readonly value: unknown }
  | { readonly type: 'bytes'; readonly value: Uint8Array }
  | { readonly type: 'stream'; readonly value: ReadableStream<Uint8Array> }

export type ParamsRecord = Readonly<Record<string, string>>

export type RouteHandler<E, Params extends ParamsRecord = ParamsRecord> =
  (request: ServerRequest<Params>) => Fx<E, ServerResponse<E>>

/**
 * A composable HTTP route declaration tree.
 */
export type Routes<E = never> =
  | EmptyRoutes
  | SingleRoute<E>
  | ConcatRoutes<E>
  | MountedRoutes<E>

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

export type Route<E, Params extends ParamsRecord = ParamsRecord> = {
  readonly method: Method
  readonly path: string
  readonly handle: RouteHandler<E, Params>
}

export const emptyRoutes: Routes<never> = { type: 'empty' }

export const route = <E, Params extends ParamsRecord = ParamsRecord>(
  method: Method,
  path: string,
  handle: RouteHandler<E, Params>
): Routes<E> => ({
    type: 'route',
    route: { method, path, handle: handle as RouteHandler<E> }
  })

export const routes = <const Rs extends readonly Routes<any>[]>(
  ...routes: Rs
): Routes<EffectsOfRoutes<Rs[number]>> => ({
    type: 'concat',
    routes
  })

export const mount = <E>(
  prefix: string,
  routes: Routes<E>
): Routes<E> => ({
    type: 'mount',
    prefix,
    routes
  })

export type EffectsOfRoutes<R> =
  R extends Routes<infer E> ? E : never

export type RouteTransform<E1, E2> =
  <A>(fx: Fx<E1, A>) => Fx<E2, A>

export const mapRoutes = <E1, E2>(
  routes: Routes<E1>,
  transform: (handle: RouteHandler<E1>) => RouteHandler<E2>
): Routes<E2> => {
  switch (routes.type) {
    case 'empty':
      return emptyRoutes

    case 'route':
      return {
        type: 'route',
        route: {
          ...routes.route,
          handle: transform(routes.route.handle)
        }
      }

    case 'concat':
      return {
        type: 'concat',
        routes: routes.routes.map(r => mapRoutes(r, transform))
      }

    case 'mount':
      return {
        type: 'mount',
        prefix: routes.prefix,
        routes: mapRoutes(routes.routes, transform)
      }
  }
}

export const handleRoutes = <E1, E2>(
  transform: RouteTransform<E1, E2>
) =>
  (routes: Routes<E1>): Routes<E2> =>
    mapRoutes(routes, handleRequest => request =>
      transform(handleRequest(request)))

export type ServerRouteEffects = Async | Fail<any> | Scoped<string>

export const ServeScope = 'fx/HttpServer/Serve'

/**
 * Request that an HTTP server run the provided routes.
 */
export class Serve<const E = never> extends Effect('fx/HttpServer/Serve')<ServeRequest<E>, void> { }

export type ServeRequest<E = never> = {
  readonly routes: Routes<E>
  readonly options: ServeOptions
  readonly context: readonly HandlerContext[]
}

export type ServeOptions = {
  readonly port: number
  readonly host?: string
}

export const serve = <E>(
  routes: Routes<E>,
  options: ServeOptions
): Fx<Exclude<E, ServerRouteEffects> | Serve<E> | Scoped<typeof ServeScope>, void> =>
  captureScoped(ServeScope).pipe(
    flatMap(context => new Serve<E>({ routes, options, context }))
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
  routes: compile(routes, '')
})

export const dispatch = <E>(
  compiled: CompiledRoutes<E>,
  request: ServerRequest
): Fx<E, ServerResponse<E>> => {
  for (const route of compiled.routes) {
    if (route.method !== request.method) continue

    const params = route.match(request.path)
    if (params !== false) return route.handle({ ...request, params })
  }

  return ok({
    status: 404,
    headers: [['content-type', 'text/plain; charset=utf-8']],
    body: { type: 'text', value: 'Not Found' }
  })
}

const compile = <E>(routes: Routes<E>, prefix: string): readonly CompiledRoute<E>[] => {
  switch (routes.type) {
    case 'empty':
      return []

    case 'route': {
      const path = joinPaths(prefix, routes.route.path)
      return [{
        method: routes.route.method,
        path,
        match: compilePath(path),
        handle: routes.route.handle
      }]
    }

    case 'concat':
      return routes.routes.flatMap(r => compile(r, prefix))

    case 'mount':
      return compile(routes.routes, joinPaths(prefix, routes.prefix))
  }
}

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
