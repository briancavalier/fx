import { flatMap, fx, runPromise } from '../../src/index.js'
import { get, provide } from '../../src/Env.js'
import { assert as assertNoFail } from '../../src/Fail.js'
import { expectSuccess, request, text, w3cFetch } from '../../src/HttpClient.js'

type ClientConfig = {
  readonly port: number
}

const client = fx(function* () {
  const { port } = yield* get<ClientConfig>()
  const base = `http://127.0.0.1:${port}`

  yield* request({ url: new URL('/api/health', base) }).pipe(
    flatMap(expectSuccess)
  )

  yield* request({
    method: 'POST',
    url: new URL('/api/notes', base),
    body: { type: 'text', value: 'learn algebraic effects' }
  }).pipe(
    flatMap(expectSuccess)
  )

  yield* request({
    method: 'POST',
    url: new URL('/api/notes', base),
    body: { type: 'text', value: 'ship a small http server' }
  }).pipe(
    flatMap(expectSuccess)
  )

  return yield* request({ url: new URL('/api/notes', base) }).pipe(
    flatMap(expectSuccess),
    flatMap(text)
  )
})

const notes = await client.pipe(
  w3cFetch(),
  assertNoFail,
  provide({ port: Number(process.env.PORT ?? 3000) }),
  runPromise
)

console.log(notes)
