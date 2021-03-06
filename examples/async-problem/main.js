// @flow
import { type Action, type Async, type Console, type Except, type Process, log, callNode, traverse, args } from '../../packages/core'
import path from 'path'
import fs from 'fs'

// Solving the async-problem
// See https://github.com/plaid/async-problem

const readFile = (dir: string, name: string): Action<Async | Except, string> =>
  callNode((cb) => fs.readFile(path.join(dir, name), 'utf8', cb))

const lines = (s: string): string[] =>
  s.split('\n').filter(s => s.length > 0)

export function * main (): Action<Process | Console | Async | Except, void> {
  const dir = (yield * args()).pop()
  const contents = yield * readFile(dir, 'index.txt')
  const results = yield * traverse(file => readFile(dir, file), lines(contents))
  yield * log(results.join(''))
}
