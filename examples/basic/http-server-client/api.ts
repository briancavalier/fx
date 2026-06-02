import { Effect, fx, type Fx, get, handle, map, ok } from '@briancavalier/fx'

import { bytes as readBytes } from '@briancavalier/fx/http-client'
import { mount, provideRoutesFrom, route, routes, type RouteContext, type ServerRequest, type ServerResponse } from '@briancavalier/fx/http-server'
import { info } from '@briancavalier/fx/log'
import { using, type Exit } from '@briancavalier/fx/scope'

export type Note = {
  readonly id: string
  readonly text: string
}

export type User = {
  readonly id: string
  readonly name: string
}

export class ListNotes extends Effect('example/HttpServerClient/ListNotes')<void, readonly Note[]> { }
export class AddNote extends Effect('example/HttpServerClient/AddNote')<string, Note> { }

export const listNotes = new ListNotes()
export const createNote = (text: string) => new AddNote(text)

type UserContext = {
  readonly user: User
}

type RequestAudit = {
  readonly method: string
  readonly path: string
  readonly userId: string
}

const userContext = fx(function* ({ request }: RouteContext) {
  return {
    user: fakeAuthenticate(request)
  }
})

const healthRoutes = route('GET', '/health', ok(text('ok')))

const noteRoutes = provideRoutesFrom(userContext)(routes(
  route('GET', '/notes', fx(function* ({ user }: UserContext) {
    yield* requestAudit(user)

    return json({
      user,
      notes: yield* listNotes
    })
  })),

  route('POST', '/notes', fx(function* ({ user }: UserContext) {
    yield* requestAudit(user)

    const { request: req } = yield* get<RouteContext>()
    const note = yield* createNote(`${user.name}: ${(yield* readText(req)).trim()}`)
    return json({ user, note }, 201)
  }))
))

export const appRoutes = mount('/api',
  routes(
    healthRoutes,
    noteRoutes
  )
)

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

const requestAudit = (user: User) => fx(function* () {
  const { request } = yield* get<RouteContext>()

  return yield* using(
    openRequestAudit(request, user),
    closeRequestAudit
  )
})

const openRequestAudit = (request: ServerRequest, user: User) => fx(function* () {
  const audit = {
    method: request.method,
    path: request.path,
    userId: user.id
  }

  yield* info('Request scope opened', audit)
  return audit
})

const closeRequestAudit = (audit: RequestAudit, exit: Exit) =>
  info('Request scope finalized', {
    ...audit,
    exit: exit.type
  })

function fakeAuthenticate(request: ServerRequest): User {
  const id = request.headers.find(([name]) => name.toLowerCase() === 'x-user-id')?.[1] ?? 'demo-user'
  return {
    id,
    name: id === 'demo-user' ? 'Demo User' : id
  }
}
