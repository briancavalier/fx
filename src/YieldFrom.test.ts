import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abort, orReturn } from './Abort.js'
import { unbounded } from './Concurrent.js'
import { Effect } from './Effect.js'
import { fx, ok, run, runPromise, type Fx } from './Fx.js'
import { handle, handleScoped } from './Handler.js'
import { returnFrom } from './ReturnFrom.js'
import { scope, withScope } from './Scope.js'
import { next as nextSink, Sink } from './Sink.js'
import type { Receiving } from './Sink.js'
import {
  collectFrom,
  forEachFrom,
  fromAsyncIterable,
  fromDequeue,
  fromIterable,
  to,
  toAsyncIterable,
  withEnqueue,
  YieldFrom,
  yieldFrom,
  type PipeResult
} from './YieldFrom.js'
import { Enqueue, UnboundedQueue } from './internal/Queue.js'
import { dispose } from './internal/disposable.js'
import type { Yielding } from './YieldFrom.js'

describe('YieldFrom', () => {
  const NumberScope = scope<Yielding<number>>()('test/YieldFrom/numbers')
  const NumberSinkScope = scope<Receiving<number>>()('test/YieldFrom/number-sink')
  const ItemScope = scope<Yielding<'item'>>()('test/YieldFrom/item')
  const DecisionScope = scope<Yielding<string, boolean>>()('test/YieldFrom/decision')

  it('allows sink scopes independent of YieldFrom protocols', () => {
    const SinkOnlyScope = scope<Receiving<number>>()('test/YieldFrom/sink-only')
    const f = fx(function* () {
      const value = yield* nextSink(SinkOnlyScope)
      return value + 1
    })

    const _: typeof f extends Fx<Sink<typeof SinkOnlyScope>, number> ? true : false = true
    const next = f[Symbol.iterator]().next()

    assert.equal(Sink.is(next.value), true)
    assert.equal((next.value as Sink<typeof SinkOnlyScope>).scope, SinkOnlyScope)
    void _
  })

  it('collects one-way yields from the matching scope', () => {
    const result = fx(function* () {
      yield* yieldFrom(NumberScope, 1)
      yield* yieldFrom(NumberScope, 2)
      return 'done'
    }).pipe(
      collectFrom(NumberScope),
      run
    )

    assert.deepEqual(result, ['done', [1, 2]])
  })

  it('does not collect yields from a same-name different scope token', () => {
    const FirstScope = scope<Yielding<'first'>>()('test/YieldFrom/same-name')
    const SecondScope = scope<Yielding<'second'>>()('test/YieldFrom/same-name')
    const f = fx(function* () {
      yield* yieldFrom(SecondScope, 'second')
      return 'done'
    }).pipe(collectFrom(FirstScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(YieldFrom.is(next.value), true)
    assert.equal((next.value as YieldFrom<typeof SecondScope>).scope, SecondScope)
  })

  it('preserves yield order and final result when collecting', () => {
    const result = fx(function* () {
      for (let i = 0; i < 4; ++i) yield* yieldFrom(NumberScope, i)
      return 4
    }).pipe(
      collectFrom(NumberScope),
      run
    )

    assert.deepEqual(result, [4, [0, 1, 2, 3]])
  })

  it('propagates yields from a different scope', () => {
    const OtherScope = scope<Yielding<'other'>>()('test/YieldFrom/other')

    const f = fx(function* () {
      yield* yieldFrom(OtherScope, 'other')
      return 'done'
    }).pipe(handleScoped(YieldFrom<typeof NumberScope>, NumberScope, () => ok(undefined)))

    const _: typeof f extends Fx<YieldFrom<typeof OtherScope>, string> ? true : false = true
    const next = f[Symbol.iterator]().next()

    assert.equal(YieldFrom.is(next.value), true)
    const effect = next.value as YieldFrom<typeof OtherScope>
    assert.equal(effect.scope, OtherScope)
    assert.equal(effect.arg, 'other')
  })

  it('handles nested named yield scopes independently', () => {
    const InnerScope = scope<Yielding<'inner'>>()('test/YieldFrom/inner')
    const outer = [] as number[]
    const inner = [] as string[]

    const result = fx(function* () {
      yield* yieldFrom(NumberScope, 2)
      yield* yieldFrom(InnerScope, 'inner')
      return 'done'
    }).pipe(
      handleScoped(YieldFrom<typeof InnerScope>, InnerScope, effect => ok(void inner.push(effect.arg))),
      handleScoped(YieldFrom<typeof NumberScope>, NumberScope, effect => ok(void outer.push(effect.arg))),
      run
    )

    assert.equal(result, 'done')
    assert.deepEqual(outer, [2])
    assert.deepEqual(inner, ['inner'])
  })

  it('narrows matching YieldFrom effects', () => {
    const f = fx(function* () {
      yield* yieldFrom(ItemScope, 'item')
      return true
    }).pipe(handleScoped(YieldFrom<typeof ItemScope>, ItemScope, () => ok(undefined)))

    const _: typeof f extends Fx<never, boolean> ? true : false = true

    assert.equal(f.pipe(run), true)
  })

  it('resumes with the branded input type', () => {
    const f = fx(function* () {
      const accepted = yield* yieldFrom(DecisionScope, 'item')
      const _: boolean = accepted
      return accepted ? 'accepted' : 'rejected'
    }).pipe(handleScoped(YieldFrom<typeof DecisionScope>, DecisionScope, effect => ok(effect.arg === 'item')))

    const _: typeof f extends Fx<never, 'accepted' | 'rejected'> ? true : false = true

    assert.equal(f.pipe(run), 'accepted')
  })

  it('requires yielded values to match the scope brand', () => {
    // @ts-expect-error NumberScope yields numbers
    const _ = yieldFrom(NumberScope, 'not a number')

    assert.equal(typeof _, 'object')
  })

  it('allows ReturnFrom from a yield handler', () => {
    const ReturnScope = scope('test/YieldFrom/return')

    const result = fx(function* () {
      yield* yieldFrom(ItemScope, 'item')
      return 'late'
    }).pipe(
      handleScoped(YieldFrom<typeof ItemScope>, ItemScope, () => returnFrom(ReturnScope, 'early')),
      withScope(ReturnScope),
      run
    )

    assert.equal(result, 'early')
  })

  it('allows Abort from a yield handler', () => {
    const AbortScope = scope('test/YieldFrom/abort')

    const result = fx(function* () {
      yield* yieldFrom(ItemScope, 'item')
      return 'late'
    }).pipe(
      handleScoped(YieldFrom<typeof ItemScope>, ItemScope, () => abort(AbortScope)),
      withScope(AbortScope),
      orReturn(AbortScope, 'aborted'),
      run
    )

    assert.equal(result, 'aborted')
  })

  it('applies an effectful function to each yield from a scope', () => {
    const seen: number[] = []

    const result = fx(function* () {
      yield* yieldFrom(NumberScope, 1)
      yield* yieldFrom(NumberScope, 2)
      return 'done'
    }).pipe(
      f => forEachFrom(NumberScope, f, n => ok(void seen.push(n))),
      run
    )

    assert.equal(result, 'done')
    assert.deepEqual(seen, [1, 2])
  })

  it('converts a dequeue to scoped yields', async () => {
    const expected = [1, 2, 3]
    const queue = new UnboundedQueue<number>()

    enqueueAllAsync(queue, expected)

    const [result, values] = await fromDequeue(NumberScope, queue).pipe(
      collectFrom(NumberScope),
      runPromise
    )

    assert.equal(result, undefined)
    assert.deepEqual(values, expected)
  })

  it('converts enqueued values to scoped yields and disposes the producer', async () => {
    const expected = [1, 2, 3]
    const queue = new UnboundedQueue<number>()
    let disposed = false

    const [result, values] = await withEnqueue(NumberScope, q => {
      enqueueAllAsync(q, expected)

      return {
        [Symbol.dispose]: () => { disposed = true }
      }
    }, queue).pipe(
      collectFrom(NumberScope),
      runPromise
    )

    assert.equal(result, undefined)
    assert.deepEqual(values, expected)
    assert.equal(disposed, true)
    assert.equal(queue.disposed, true)
  })

  it('converts an iterable to scoped yields', () => {
    const inputs = [1, 2, 3]

    function* makeIterable() {
      yield* inputs
      return 'source'
    }

    const [result, values] = fromIterable(NumberScope, makeIterable()).pipe(
      collectFrom(NumberScope),
      run
    )

    assert.equal(result, 'source')
    assert.deepEqual(values, inputs)
  })

  it('converts an async iterable to scoped yields', async () => {
    const inputs = [1, 2, 3]

    async function* makeAsyncIterable() {
      for (const input of inputs) yield input
      return 'source'
    }

    const [result, values] = await fromAsyncIterable(NumberScope, makeAsyncIterable).pipe(
      collectFrom(NumberScope),
      unbounded,
      runPromise
    )

    assert.equal(result, 'source')
    assert.deepEqual(values, inputs)
  })

  it('converts scoped yields to an async iterable', async () => {
    const inputs = [1, 2, 3]
    const asyncIterable = toAsyncIterable(NumberScope, fx(function* () {
      for (const input of inputs) yield* yieldFrom(NumberScope, input)
      return 'done'
    }))

    const values = []
    const iterator = asyncIterable[Symbol.asyncIterator]()
    let result = await iterator.next()
    while (!result.done) {
      values.push(result.value)
      result = await iterator.next()
    }

    assert.deepEqual(values, inputs)
    assert.equal(result.value, 'done')
  })

  describe('to', () => {
    it('returns sourceEnded when the source ends before the sink', () => {
      const actual: number[] = []
      const sink = fx(function* () {
        while (true) actual.push(yield* nextSink(NumberSinkScope))
      })

      const result = fromIterable(NumberScope, [1, 2, 3][Symbol.iterator]()).pipe(
        source => to(NumberScope, NumberSinkScope, source, sink),
        run
      )

      assert.deepEqual(result, { type: 'sourceEnded', value: undefined })
      assert.deepEqual(actual, [1, 2, 3])
    })

    it('returns sinkEnded when the sink ends before the source', () => {
      const actual: number[] = []
      const source = fx(function* () {
        let i = 1
        while (true) yield* yieldFrom(NumberScope, i++)
      })
      const sink = fx(function* () {
        for (let i = 0; i < 3; ++i) actual.push(yield* nextSink(NumberSinkScope))
        return 'sink'
      })

      const result = to(NumberScope, NumberSinkScope, source, sink).pipe(run)

      assert.deepEqual(result, { type: 'sinkEnded', value: 'sink' })
      assert.deepEqual(actual, [1, 2, 3])
    })

    it('prefers sinkEnded when source and sink complete together', () => {
      const source = fromIterable(NumberScope, [1, 2, 3][Symbol.iterator]())
      const sink = fx(function* () {
        for (let i = 0; i < 3; ++i) yield* nextSink(NumberSinkScope)
        return 'sink'
      })

      const result = to(NumberScope, NumberSinkScope, source, sink).pipe(run)

      assert.deepEqual(result, { type: 'sinkEnded', value: 'sink' })
    })

    it('distinguishes source and sink results with the same value type', () => {
      const source = fromIterable(NumberScope, [1][Symbol.iterator]())
      const sink = fx(function* () {
        yield* nextSink(NumberSinkScope)
        return undefined
      })

      const result: PipeResult<undefined, undefined> = to(NumberScope, NumberSinkScope, source, sink).pipe(run)

      assert.equal(result.type, 'sinkEnded')
      assert.equal(result.value, undefined)
    })

    it('leaves unrelated YieldFrom and Sink scopes visible', () => {
      const OtherScope = scope<Yielding<'other'>>()('test/YieldFrom/other-to')
      const OtherSinkScope = scope<Receiving<'other'>>()('test/YieldFrom/other-sink-to')
      const source = fx(function* () {
        yield* yieldFrom(OtherScope, 'other')
        return 'source'
      })
      const sink = fx(function* () {
        yield* nextSink(OtherSinkScope)
        return 'sink'
      })

      const piped = to(NumberScope, NumberSinkScope, source, sink)
      const _: typeof piped extends Fx<YieldFrom<typeof OtherScope> | Sink<typeof OtherSinkScope>, PipeResult<string, string>> ? true : false = true

      void _
    })

    it('does not advance source past unrelated effects after sink ends', () => {
      class Other extends Effect('test/YieldFrom/to/source-unrelated')<void, void> { }
      const source = fx(function* () {
        yield* new Other()
        return 'source'
      })
      const sink = ok('sink')
      let advanced = false

      const result = to(NumberScope, NumberSinkScope, source, sink).pipe(
        handle(Other, () => {
          advanced = true
          return ok(undefined)
        }),
        run
      )

      assert.deepEqual(result, { type: 'sinkEnded', value: 'sink' })
      assert.equal(advanced, false)
    })

    it('does not advance sink past unrelated effects after source ends', () => {
      class Other extends Effect('test/YieldFrom/to/sink-unrelated')<void, void> { }
      const source = ok('source')
      const sink = fx(function* () {
        yield* new Other()
        return 'sink'
      })
      let advanced = false

      const result = to(NumberScope, NumberSinkScope, source, sink).pipe(
        handle(Other, () => {
          advanced = true
          return ok(undefined)
        }),
        run
      )

      assert.deepEqual(result, { type: 'sourceEnded', value: 'source' })
      assert.equal(advanced, false)
    })

    it('consumes matching source yields during source cleanup', () => {
      const cleanup: string[] = []
      const source = fx(function* () {
        try {
          let i = 1
          while (true) yield* yieldFrom(NumberScope, i++)
        } finally {
          cleanup.push('before')
          yield* yieldFrom(NumberScope, 999)
          cleanup.push('after')
        }
      })
      const sink = fx(function* () {
        yield* nextSink(NumberSinkScope)
        return 'sink'
      })

      const result = to(NumberScope, NumberSinkScope, source, sink).pipe(run)

      assert.deepEqual(result, { type: 'sinkEnded', value: 'sink' })
      assert.deepEqual(cleanup, ['before', 'after'])
    })

    it('consumes matching sink requests during sink cleanup', () => {
      const cleanup: unknown[] = []
      const source = fromIterable(NumberScope, [1][Symbol.iterator]())
      const sink = fx(function* () {
        try {
          while (true) yield* nextSink(NumberSinkScope)
        } finally {
          cleanup.push('before')
          cleanup.push(yield* nextSink(NumberSinkScope))
          cleanup.push('after')
        }
      })

      const result = to(NumberScope, NumberSinkScope, source, sink).pipe(run)

      assert.deepEqual(result, { type: 'sourceEnded', value: undefined })
      assert.deepEqual(cleanup, ['before', undefined, 'after'])
    })

    it('rejects bidirectional YieldFrom scopes', () => {
      const DecisionSinkScope = scope<Receiving<string>>()('test/YieldFrom/decision-sink')
      const source = fx(function* () {
        yield* yieldFrom(DecisionScope, 'item')
      })
      const sink = fx(function* () {
        yield* nextSink(DecisionSinkScope)
      })

      // @ts-expect-error to only supports one-way YieldFrom scopes
      const _ = to(DecisionScope, DecisionSinkScope, source, sink)

      assert.equal(typeof _, 'object')
    })

    it('rejects sinks that cannot receive the yielded values', () => {
      const StringSinkScope = scope<Receiving<string>>()('test/YieldFrom/string-sink')
      const source = fx(function* () {
        yield* yieldFrom(NumberScope, 1)
      })
      const sink = fx(function* () {
        yield* nextSink(StringSinkScope)
      })

      // @ts-expect-error sink input must accept source yield output
      const _ = to(NumberScope, StringSinkScope, source, sink)

      assert.equal(typeof _, 'object')
    })
  })
})

const enqueueAllAsync = <A>(queue: Enqueue<A>, values: readonly A[]) => {
  if (values.length === 0) return dispose(queue)

  const [a, ...rest] = values
  queue.enqueue(a)
  setTimeout(enqueueAllAsync, 0, queue, rest)
}
