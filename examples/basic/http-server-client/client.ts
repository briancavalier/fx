import { assert as assertNoFail, runCatch, flatMap, fx, provide, runPromise } from '@briancavalier/fx'

import { expectSuccess, request, text, w3cFetch } from '@briancavalier/fx/http-client'

type ClientConfig = {
  readonly port: number
}

const client = fx(function* ({ port }: ClientConfig) {
  const base = `http://127.0.0.1:${port}`
  const userHeaders = [['x-user-id', 'ada']] as const

  yield* request({ url: new URL('/api/health', base) }).pipe(
    flatMap(expectSuccess)
  )

  yield* request({
    method: 'POST',
    url: new URL('/api/notes', base),
    headers: userHeaders,
    body: { type: 'text', value: 'learn algebraic effects' }
  }).pipe(
    flatMap(expectSuccess)
  )

  yield* request({
    method: 'POST',
    url: new URL('/api/notes', base),
    headers: userHeaders,
    body: { type: 'text', value: 'ship a small http server' }
  }).pipe(
    flatMap(expectSuccess)
  )

  return yield* request({
    url: new URL('/api/notes', base),
    headers: userHeaders
  }).pipe(
    flatMap(expectSuccess),
    flatMap(text)
  )
})

const notes = await client.pipe(
  w3cFetch(),
  assertNoFail, runCatch,
  provide({ port: Number(process.env.PORT ?? 3000) }),
  runPromise
)

console.log(notes)
