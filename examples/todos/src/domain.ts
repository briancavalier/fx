export type Document = {
  readonly id: string
  readonly name: string
  readonly todos: readonly Todo[]
}

export type Todo = {
  readonly id: string
  readonly text: string
  readonly completed: boolean
}
