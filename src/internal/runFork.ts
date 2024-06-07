import { Async } from '../Async'
import { Fail } from '../Fail'
import { Fork, ForkContext } from '../Fork'
import { Fx } from '../Fx'
import { Task } from '../Task'
import { Handler, } from './Handler'
import { GetHandlerContext, HandlerContext } from './HandlerContext'
import { Semaphore } from './Semaphore'
import { DisposableSet, dispose } from './disposable'

type RunForkOptions = {
  readonly name?: string
  readonly maxConcurrency?: number
}

export const runFork = <const E extends Async | Fork | Fail<unknown> | GetHandlerContext, const A>(f: Fx<E, A>, o: RunForkOptions = {}): Task<A, Extract<E, Fail<any>>> => {
  const disposables = new DisposableSet()

  const promise = runForkInternal(f, [], new Semaphore(o.maxConcurrency ?? Infinity), disposables, o.name)
    .finally(() => dispose(disposables))

  return new Task(promise, disposables)
}

export const acquireAndRunFork = (f: ForkContext, s: Semaphore, context: readonly HandlerContext[]): Task<unknown, unknown> => {
  const disposables = new DisposableSet()

  const promise = acquire(s, disposables,
    () => runForkInternal(withContext([...f.context, ...context], f.fx), context, s, disposables, f.name)
      .finally(() => dispose(disposables)))

  return new Task(promise, disposables)
}

const runForkInternal = <const E, const A>(
  f: Fx<E, A>,
  context: readonly HandlerContext[],
  semaphore: Semaphore,
  disposables: DisposableSet,
  name?: string
): Promise<A> =>
  new Promise<A>(async (resolve, reject) => {
    const i = f[Symbol.iterator]()
    disposables.add(new IteratorDisposable(i))
    let ir = i.next()

    while (!ir.done) {
      if (Async.is(ir.value)) {
        const t = runTask(ir.value.arg)
        disposables.add(t)
        const a = await t.promise
          .finally(() => disposables.remove(t))
          .catch(e => reject(new TaskError('Awaited Async effect failed', e, name)))
        // stop if the scope was disposed while we were waiting
        if (disposables.disposed) return
        ir = i.next(a)
      } else if (Fork.is(ir.value)) {
        const t = acquireAndRunFork(ir.value.arg, semaphore, context)
        disposables.add(t)
        t.promise
          .finally(() => disposables.remove(t))
          .catch(reject) // subtask errors should already be wrapped in TaskError
        ir = i.next(t)
      } else if (GetHandlerContext.is(ir.value)) {
        ir = i.next(context)
      } else if (Fail.is(ir.value))
        return reject(ir.value.arg instanceof TaskError
          ? ir.value.arg
          : new TaskError('Unhandled failure in forked task', ir.value.arg, name))
      else
        return reject(new TaskError('Unexpected effect in forked task', ir.value, name))
    }
    resolve(ir.value as A)
  })

class TaskError extends Error {
  constructor(message: string, cause: unknown, public readonly task?: string) {
    super(task ? `[${task}] ${message}` : message, { cause })
  }
}

const acquire = async <A>(s: Semaphore, scope: DisposableSet, f: () => Promise<A>) => {
  const a = s.acquire()

  try {
    scope.add(a)
    await a.promise
    scope.remove(a)
    return await f()
  } finally {
    s.release()
  }
}

const runTask = <A>(run: (s: AbortSignal) => Promise<A>) => {
  const s = new DisposableAbortController()
  return new Task<A, unknown>(run(s.signal), s)
}

const withContext = (c: readonly HandlerContext[], f: Fx<unknown, unknown>) =>
  c.reduce((f, handler) => new Handler(f, handler.handlers, new Map()), f)

class DisposableAbortController extends AbortController {
  [Symbol.dispose]() { this.abort() }
}

class IteratorDisposable {
  constructor(private readonly iterator: Iterator<unknown>) { }
  [Symbol.dispose]() { this.iterator.return?.() }
}
