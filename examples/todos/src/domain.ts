export type DocumentId = string & { readonly type: Document }

export type Document = {
  readonly id: DocumentId
  readonly title: string
  readonly todos: readonly Todo[]
}

export type TodoId = string & { readonly type: Todo }

export type Todo = {
  readonly id: TodoId
  readonly text: string
  readonly complete: boolean
}
