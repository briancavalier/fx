import * as assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { nodeSourceLookup } from './TraceNode.js'

describe('TraceNode', () => {
  describe('nodeSourceLookup', () => {
    it('reads absolute file paths', () => {
      const path = fixture('absolute.ts', 'const absolute = true')
      const lookup = nodeSourceLookup()

      assert.equal(lookup({ raw: '', file: path }), 'const absolute = true')
    })

    it('reads file URLs', () => {
      const path = fixture('url.ts', 'const url = true')
      const lookup = nodeSourceLookup()

      assert.equal(lookup({ raw: '', file: pathToFileURL(path).href }), 'const url = true')
    })

    it('resolves relative paths from cwd', () => {
      const path = fixture('relative.ts', 'const relativePath = true')
      const lookup = nodeSourceLookup()

      assert.equal(lookup({ raw: '', file: relative(process.cwd(), path) }), 'const relativePath = true')
    })

    it('returns undefined for missing, directory, and non-file paths', () => {
      const directory = join(mkdtempSync(join(tmpdir(), 'fx-trace-node-')), 'directory')
      mkdirSync(directory)
      const lookup = nodeSourceLookup()

      assert.equal(lookup({ raw: '', file: join(directory, 'missing.ts') }), undefined)
      assert.equal(lookup({ raw: '', file: directory }), undefined)
      assert.equal(lookup({ raw: '', file: 'https://example.com/file.ts' }), undefined)
      assert.equal(lookup({ raw: '', file: 'file://%' }), undefined)
    })

    it('caches successful reads', () => {
      const path = fixture('cached.ts', 'const cached = 1')
      const lookup = nodeSourceLookup()

      assert.equal(lookup({ raw: '', file: path }), 'const cached = 1')
      writeFileSync(path, 'const cached = 2')
      assert.equal(lookup({ raw: '', file: path }), 'const cached = 1')
    })
  })
})

const fixture = (name: string, source: string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fx-trace-node-'))
  const path = join(directory, name)
  writeFileSync(path, source)
  return path
}
