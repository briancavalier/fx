export type SettledTask<Task> =
  | { readonly task: Task, readonly type: 'success', readonly value: unknown }
  | { readonly task: Task, readonly type: 'failure', readonly failure: unknown }

export class SettledQueue<A> {
  private readonly values = [] as A[]
  private waiters = [] as ((value: A) => void)[]

  push(value: A) {
    const waiter = this.waiters.shift()
    if (waiter === undefined) {
      this.values.push(value)
    } else {
      waiter(value)
    }
  }

  next(): Promise<A> {
    const value = this.values.shift()
    return value === undefined
      ? new Promise(resolve => this.waiters.push(resolve))
      : Promise.resolve(value)
  }
}

export const settledTaskQueue = <Task extends { readonly promise: Promise<unknown> }>(
  tasks: Iterable<Task>
): SettledQueue<SettledTask<Task>> => {
  const queue = new SettledQueue<SettledTask<Task>>()
  for (const task of tasks) {
    task.promise.then(
      value => queue.push({ task, type: 'success', value }),
      failure => queue.push({ task, type: 'failure', failure })
    )
  }
  return queue
}
