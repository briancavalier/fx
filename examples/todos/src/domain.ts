export type Document = {
  readonly id: Id<'todos/Document'>
  readonly title: string
  readonly todos: readonly Todo[]
}

export type Todo = {
  readonly id: Id<'todos/Todo'>
  readonly text: string
  readonly complete: boolean
}

export type Id<A> = string & { readonly tag: A }
