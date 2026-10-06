import { test } from 'node:test'
import assert from 'node:assert/strict'
import { split, streamTitle } from './radio-now.js'

test('split: "Artist - Title", or a bare title', () => {
  assert.deepEqual(split('DEADLIFE - Emotional Barrier'), { artist: 'DEADLIFE', title: 'Emotional Barrier' })
  assert.deepEqual(split('A - B - C'), { artist: 'A', title: 'B - C' })
  assert.deepEqual(split('Just a title'), { artist: null, title: 'Just a title' })
  assert.deepEqual(split(null), { artist: null, title: '' })
})

test("streamTitle: the ICY block's StreamTitle, quotes inside kept", () => {
  assert.equal(streamTitle("StreamTitle='Kenjiro Sakiya - Parallel Line';StreamUrl='';\0\0\0"), 'Kenjiro Sakiya - Parallel Line')
  assert.equal(streamTitle("StreamTitle='Don't Stop - Mix';"), "Don't Stop - Mix")
  assert.equal(streamTitle('nothing here'), null)
})
