export type Command = {
  readonly tag: "add-todo"
  readonly id: string
  readonly text: string
} |
{
  readonly tag: "complete-todo"
  readonly id: string
  readonly completed: boolean
}

export type Event = {
  readonly tag: "todo-added"
  readonly id: string
  readonly text: string
} |
{
  readonly tag: "todo-completed"
  readonly id: string
  readonly completed: boolean
}
