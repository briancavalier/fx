import { DocumentId, Todo, TodoId } from './domain'

export type Command = {
  readonly tag: 'add-todo'
  readonly id: DocumentId
  readonly text: string
} |
{
  readonly tag: 'remove-todo'
  readonly id: DocumentId
  readonly todoId: TodoId
} |
{
  readonly tag: 'update-todo-complete'
  readonly id: DocumentId
  readonly todoId: TodoId
  readonly complete: boolean
} |
{
  readonly tag: 'update-todo-text'
  readonly id: DocumentId
  readonly todoId: TodoId
  readonly text: string
}

export type Event = {
  readonly tag: 'todo-added'
  readonly id: DocumentId
  readonly todo: Todo
} |
{
  readonly tag: 'todo-removed'
  readonly id: DocumentId
  readonly todoId: TodoId
} |
{
  readonly tag: 'todo-text-updated'
  readonly id: DocumentId
  readonly todo: Todo
} |
{
  readonly tag: 'todo-complete-updated'
  readonly id: DocumentId
  readonly todo: Todo
}
