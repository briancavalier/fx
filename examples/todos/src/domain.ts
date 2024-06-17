export type DocumentId = Id<'todos/Document'>
export type TodoId = Id<'todos/Todo'>

export type Todo = {
  readonly id: TodoId
  readonly text: string
  readonly complete: boolean
}

export type Id<A> = string & { readonly tag: A }
