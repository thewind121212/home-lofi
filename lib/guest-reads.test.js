// A guest's News / GitHub read state on their device (lib/guest-reads.js), localStorage stood in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guestReads } from './guest-reads.js'

const fakeStorage = (broken = false) => {
  const m = new Map()
  return {
    getItem: (k) => (broken ? null : (m.get(k) ?? null)),
    setItem: (k, v) => {
      if (broken) throw new Error('QuotaExceededError')
      m.set(k, String(v))
    },
  }
}

test('reads, unreads and the seen edition are kept per key', () => {
  globalThis.localStorage = fakeStorage()
  const news = guestReads('news'), gh = guestReads('gh')
  assert.deepEqual(news.load(), { read: [], seen: null })
  news.apply({ action: 'read', ids: ['a', 'b'] })
  news.apply({ action: 'read', ids: ['b', 'c'] })
  news.apply({ action: 'unread', ids: ['a'] })
  news.apply({ action: 'seen', at: 200 })
  news.apply({ action: 'seen', at: 100 })
  assert.deepEqual(news.load(), { read: ['b', 'c'], seen: 200 }, 'seen only goes forward')
  assert.deepEqual(gh.load(), { read: [], seen: null }, 'GitHub\'s apart')
})

test('only the newest 600 kept; junk or no storage: nothing read', () => {
  globalThis.localStorage = fakeStorage()
  const r = guestReads('k')
  r.apply({ action: 'read', ids: Array.from({ length: 700 }, (_, i) => `s${i}`) })
  const { read } = r.load()
  assert.deepEqual([read.length, read[0], read.at(-1)], [600, 's100', 's699'])
  localStorage.setItem('k', '{"read":[1,"x",null],"seen":"soon"}')
  assert.deepEqual(r.load(), { read: ['x'], seen: null })
  localStorage.setItem('k', 'not json')
  assert.deepEqual(r.load(), { read: [], seen: null })
  globalThis.localStorage = fakeStorage(true)
  assert.doesNotThrow(() => r.apply({ action: 'read', ids: ['a'] }))
  delete globalThis.localStorage
  assert.deepEqual(guestReads('k').load(), { read: [], seen: null })
})
