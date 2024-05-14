export interface TypeError<Message extends string, Context> {
  message: Message
  context: Context
  readonly _: unique symbol
}
