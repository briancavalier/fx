import { Document, Id, Todo } from './domain'

export type Command = {
  readonly tag: 'add-todo'
  readonly id: Id<'todos/Documment'>
  readonly text: string
} |
{
  readonly tag: 'remove-todo'
  readonly id: Id<'todos/Documment'>
  readonly todoId: Id<'todos/Todo'>
} |
{
  readonly tag: 'update-todo-complete'
  readonly id: Id<Document>
  readonly todoId: Id<'todos/Todo'>
  readonly complete: boolean
} |
{
  readonly tag: 'update-todo-text'
  readonly id: Id<Document>
  readonly todoId: Id<'todos/Todo'>
  readonly text: string
}

export type Event = {
  readonly tag: 'todo-added'
  readonly id: Id<'todos/Documment'>
  readonly todo: Todo
} |
{
  readonly tag: 'todo-removed'
  readonly id: Id<Document>
  readonly todoId: Id<'todos/Todo'>
} |
{
  readonly tag: 'todo-text-updated'
  readonly id: Id<'todos/Documment'>
  readonly todo: Todo
} |
{
  readonly tag: 'todo-complete-updated'
  readonly id: Id<'todos/Documment'>
  readonly todo: Todo
}
