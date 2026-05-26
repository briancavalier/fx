import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise } from './Async.js'
import { fork, unbounded } from './Concurrent.js'
import { Effect } from './Effect.js'
import { get, provideAll } from './Env.js'
import { Fail, returnFail } from './Fail.js'
import { assertSync, flatMap, fx, ok, run, runPromise, runTask, trySync } from './Fx.js'
import { control, handle } from './Handler.js'
import { wait } from './Task.js'
import { getTrace } from './Trace.js'

describe('Fx', () => {
  describe('fx', () => {
    it('given contextual parameter, receives environment', () => {
      const actual = fx(function* ({ name }: { readonly name: string }) {
        return `hello ${name}`
      }).pipe(
        provideAll({ name: 'Brian' }),
        run
      )

      assert.equal(actual, 'hello Brian')
    })

    it('given this arg and contextual parameter, receives both', () => {
      const self = { greeting: 'hello' }

      const actual = fx(self, function* (this: typeof self, { name }: { readonly name: string }) {
        return `${this.greeting} ${name}`
      }).pipe(
        provideAll({ name: 'Brian' }),
        run
      )

      assert.equal(actual, 'hello Brian')
    })

    it('given this arg, executes generator with it', () => {
      const expected = { foo: 'bar' }
      const actual = fx(expected, function* () {
        return this
      }).pipe(run)

      assert.equal(actual, expected)
    })

    it('given no this arg, executes generator with undefined', () => {
      const actual = fx(function* () {
        // @ts-expect-error `this` is not set
        return this
      }).pipe(run)

      assert.equal(actual, undefined)
    })
  })

  describe('flatMap', () => {
    it('given mapping function, returns result', () => {
      const r = ok(1).pipe(flatMap(x => ok(x + 1)), run)
      assert.equal(r, 2)
    })

    it('given mapping function with effect, merges effects', () => {
      class E1<A> extends Effect('E1')<A, A> { }
      class E2<A> extends Effect('E2')<A, A> { }

      const r = new E1(1).pipe(
        flatMap(a => new E2(`${a}`)),
        handle(E1, e => ok(e.arg)),
        handle(E2, e => ok(e.arg)),
        run
      )

      assert.equal(r, '1')
    })

    it('handler callbacks receive the original effect instance', () => {
      class Request extends Effect('Request')<number, number> {
        readonly metadata = 'request metadata'
      }

      let handled: Request | undefined
      const request = new Request(1)

      const actual = request.pipe(
        handle(Request, effect => {
          handled = effect
          return ok(effect.arg + 1)
        }),
        run
      )

      assert.equal(actual, 2)
      assert.equal(handled, request)
      assert.equal(handled.metadata, 'request metadata')
    })

    it('control callbacks receive the original effect instance', () => {
      class Request extends Effect('ControlledRequest')<number, number> {
        readonly metadata = 'controlled metadata'
      }

      let handled: Request | undefined
      const request = new Request(1)

      const actual = request.pipe(
        control(Request, (resume, effect) => {
          handled = effect
          return ok(resume(effect.arg + 1))
        }),
        run
      )

      assert.equal(actual, 2)
      assert.equal(handled, request)
      assert.equal(handled.metadata, 'controlled metadata')
    })

    it('has ok as left identity', () => {
      const x = Math.random()
      const r1 = ok(x).pipe(flatMap(x => ok(x + 1)), run)
      const r2 = ok(x).pipe(flatMap(ok), flatMap(x => ok(x + 1)), run)
      assert.equal(r1, r2)
    })

    it('has ok as right identity', () => {
      const x = Math.random()
      const r1 = ok(x).pipe(flatMap(x => ok(x + 1)), run)
      const r2 = ok(x).pipe(flatMap(x => ok(x + 1)), flatMap(ok), run)
      assert.equal(r1, r2)
    })

    it('is associative', () => {
      const x = Math.random()
      const f = (x: number) => ok(x + 1)
      const g = (x: number) => ok(x * 2)

      const r1 = ok(x).pipe(flatMap(f), flatMap(g), run)
      const r2 = ok(x).pipe(flatMap(x => f(x).pipe(flatMap(g))), run)
      assert.equal(r1, r2)
    })
  })

  describe('assertSync', () => {
    it('given thunk, returns result', () => {
      const x = Math.random()
      const r = assertSync(() => x).pipe(run)
      assert.equal(r, x)
    })

    it('given thunk throws, throws', () => {
      const e = new Error()
      assert.throws(() => assertSync(() => { throw e }).pipe(run), e)
    })
  })

  describe('trySync', () => {
    it('given thunk, returns result', () => {
      const x = Math.random()
      const r = trySync(() => x).pipe(returnFail, run)
      assert.equal(r, x)
    })

    it('given thunk throws, produces Fail', () => {
      const e = new Error()
      const r = trySync(() => { throw e }).pipe(returnFail, run)
      assert.ok(Fail.is(r))
      assert.equal(r.arg, e)
    })
  })

  describe('runTask', () => {
    it('reports the Async call site for rejected Async work', async () => {
      const cause = new Error('runTask failed')

      await assert.rejects(
        runTask(assertPromise(() => Promise.reject(cause))).promise,
        e => e instanceof Error
          && firstLine(e).includes('fx/Async/assertPromise')
          && (e.stack ?? '').includes('Fx.test.ts')
          && traceMessages(e)[0] === 'fx/Async/assertPromise'
          && traceMessages(e).includes('fx/runTask')
          && e.cause === cause
      )
    })

    it('requires required environment to be provided before running', async () => {
      const required = fx(function* ({ name }: { readonly name: string }) {
        return name
      })
      const optional = fx(function* ({ name }: { readonly name?: string }) {
        return name ?? 'anonymous'
      })
      const mixed = required.pipe(flatMap(() => optional))

      // @ts-expect-error required env remains unhandled at the runtime boundary
      runTask(required)
      // @ts-expect-error mixed env still includes a required branch
      runTask(mixed)

      assert.equal(await runTask(optional).promise, 'anonymous')
      assert.equal(await runTask(required.pipe(provideAll({ name: 'Brian' }))).promise, 'Brian')
      assert.equal(await runTask(mixed.pipe(provideAll({ name: 'Brian' }))).promise, 'Brian')
    })

    it('reuses one default environment object across gets', async () => {
      const actual = await runTask(fx(function* () {
        const a = yield* get<{ count?: number }>()
        a.count = (a.count ?? 0) + 1
        const b = yield* get<{ count?: number }>()
        return { same: a === b, count: b.count }
      })).promise

      assert.deepEqual(actual, { same: true, count: 1 })
    })

    it('shares one default environment object across forked tasks', async () => {
      const actual = await runTask(fx(function* () {
        const parent = yield* get<{ count?: number }>()
        parent.count = 1

        const child = yield* fork(fx(function* () {
          const env = yield* get<{ count?: number }>()
          env.count = (env.count ?? 0) + 1
          return { sameAsParent: env === parent, count: env.count }
        }))

        const childResult = yield* wait(child)
        const after = yield* get<{ count?: number }>()
        return { childResult, sameAfterWait: after === parent, count: after.count }
      }).pipe(unbounded)).promise

      assert.deepEqual(actual, {
        childResult: { sameAsParent: true, count: 2 },
        sameAfterWait: true,
        count: 2
      })
    })
  })

  describe('runPromise', () => {
    it('reports the Async call site for rejected Async work', async () => {
      const cause = new Error('runPromise failed')

      await assert.rejects(
        runPromise(assertPromise(() => Promise.reject(cause))),
        e => e instanceof Error
          && firstLine(e).includes('fx/Async/assertPromise')
          && (e.stack ?? '').includes('Fx.test.ts')
          && traceMessages(e)[0] === 'fx/Async/assertPromise'
          && traceMessages(e).includes('fx/runPromise')
          && e.cause === cause
      )
    })

    it('does not resume the generator after Async rejection', async () => {
      const cause = new Error('async failed')
      let resumed = false

      const f = fx(function* () {
        yield* assertPromise(() => Promise.reject(cause))
        resumed = true
      })

      await assert.rejects(runPromise(f), e => e instanceof Error
        && firstLine(e).includes('fx/Async/assertPromise')
        && e.cause === cause)
      assert.equal(resumed, false)
    })

    it('wraps exceptions thrown after an awaited Async resume', async () => {
      const cause = new Error('resume failed')

      const f = fx(function* () {
        yield* assertPromise(() => Promise.resolve())
        throw cause
      })

      await assert.rejects(runPromise(f), e => e instanceof Error
        && firstLine(e).includes('fx/runPromise')
        && e.message === 'Unhandled exception in forked task'
        && e.cause === cause)
    })

    it('requires required environment to be provided before running', async () => {
      const required = fx(function* ({ name }: { readonly name: string }) {
        return name
      })
      const optional = fx(function* ({ name }: { readonly name?: string }) {
        return name ?? 'anonymous'
      })
      const mixed = required.pipe(flatMap(() => optional))

      // @ts-expect-error required env remains unhandled at the runtime boundary
      await runPromise(required)
      // @ts-expect-error mixed env still includes a required branch
      await runPromise(mixed)

      assert.equal(await runPromise(optional), 'anonymous')
      assert.equal(await runPromise(required.pipe(provideAll({ name: 'Brian' }))), 'Brian')
      assert.equal(await runPromise(mixed.pipe(provideAll({ name: 'Brian' }))), 'Brian')
    })
  })

  describe('run', () => {
    it('requires required environment to be provided before running', () => {
      const required = fx(function* ({ name }: { readonly name: string }) {
        return name
      })
      const optional = fx(function* ({ name }: { readonly name?: string }) {
        return name ?? 'anonymous'
      })
      const mixed = required.pipe(flatMap(() => optional))

      // @ts-expect-error required env remains unhandled at the runtime boundary
      run(required)
      // @ts-expect-error mixed env still includes a required branch
      run(mixed)

      assert.equal(run(optional), 'anonymous')
      assert.equal(run(required.pipe(provideAll({ name: 'Brian' }))), 'Brian')
      assert.equal(run(mixed.pipe(provideAll({ name: 'Brian' }))), 'Brian')
    })

    it('reuses one default environment object across gets', () => {
      const actual = run(fx(function* () {
        const a = yield* get<{ count?: number }>()
        a.count = (a.count ?? 0) + 1
        const b = yield* get<{ count?: number }>()
        return { same: a === b, count: b.count }
      }))

      assert.deepEqual(actual, { same: true, count: 1 })
    })
  })
})

const firstLine = (e: Error): string =>
  e.stack?.split('\n')[0] ?? ''

const traceMessages = (e: Error) => {
  const messages: string[] = []
  let trace = getTrace(e)
  while (trace !== undefined) {
    messages.push(trace.frame.message)
    trace = trace.parent
  }
  return messages
}
