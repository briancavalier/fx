import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at, indexed } from './Breadcrumb.js'

describe('Breadcrumb', () => {
  describe('indexed', () => {
    it('derives an indexed message', () => {
      const origin = at('test/origin')
      const child = indexed(origin, 2)

      assert.equal(child.message, 'test/origin[2]')
    })

    it('preserves stack frames while replacing the first-line message', () => {
      const origin = at('test/origin')
      const child = indexed(origin, 2)

      assert.match(firstLine(child.stack), /test\/origin\[2\]/)
      assert.doesNotMatch(firstLine(child.stack), /test\/origin$/)
      assert.equal(rest(child.stack), rest(origin.stack))
    })
  })
})

const firstLine = (stack: string | undefined) =>
  stack?.split('\n')[0] ?? ''

const rest = (stack: string | undefined) =>
  stack?.split('\n').slice(1).join('\n')
