import { handle } from '../../src/Handler.js'
import { bytes as readBytes } from '../../src/HttpClient.js'
import { mount, route, routes, type ServerRequest, type ServerResponse } from '../../src/HttpServer.js'
import { Effect, fx, map, ok, type Fx } from '../../src/index.js'

export type Note = {
  readonly id: string
  readonly text: string
}

export class ListNotes extends Effect('example/HttpServerClient/ListNotes')<void, readonly Note[]> { }
export class AddNote extends Effect('example/HttpServerClient/AddNote')<string, Note> { }

export const listNotes = new ListNotes()
export const createNote = (text: string) => new AddNote(text)

const apiRoutes = routes(
  route('GET', '/health', () => ok(text('ok'))),

  route('GET', '/notes', () => fx(function* () {
    return json(yield* listNotes)
  })),

  route('POST', '/notes', (req: ServerRequest) => fx(function* () {
    const note = yield* createNote((yield* readText(req)).trim())
    return json(note, 201)
  }))
)

export const appRoutes = mount('/api', apiRoutes)

export function memoryNotes() {
  const notes: Note[] = []
  let nextId = 1

  return <E, A>(program: Fx<E, A>) =>
    program.pipe(
      handle(ListNotes, () => ok(notes)),
      handle(AddNote, addNote => {
        const note = { id: String(nextId++), text: addNote.arg }
        notes.push(note)
        return ok(note)
      })
    )
}

function text(value: string, status = 200): ServerResponse<never> {
  return {
    status,
    headers: [['content-type', 'text/plain; charset=utf-8']],
    body: { type: 'text', value }
  }
}

function json(value: unknown, status = 200): ServerResponse<never> {
  return {
    status,
    body: { type: 'json', value }
  }
}

function readText(request: ServerRequest) {
  return readBytes({ status: 200, headers: [], body: request.body }).pipe(
    map((bytes: Uint8Array) => new TextDecoder().decode(bytes))
  )
}
