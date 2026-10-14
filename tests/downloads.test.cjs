const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(readFileSync('docs/archive.js', 'utf8'), sandbox);
const options = sandbox.buildDownloadOptions;
const files = [
  { name: 'd1t01.flac', format: 'Flac', size: '100' },
  { name: 'd1t02.flac', format: 'Flac', size: '200', title: 'Tuning' },
  { name: 'd1t01.mp3', format: 'VBR MP3', size: '50' },
];
test('groups formats, includes tuning, totals size, and encodes ZIP URLs', () => {
  const result = options('show name', { files });
  assert.equal(result.length, 2);
  assert.equal(result[0].count, 2);
  assert.equal(result[0].bytes, 300);
  assert.equal(result[1].url, 'https://archive.org/compress/show%20name/formats=VBR%20MP3&file=/show%20name.zip');
});
test('restricted items and Grateful Dead soundboards have no downloads', () => {
  for (const value of [true, 1, 'true', '1', ['true']]) {
    assert.equal(options('show', { files, metadata: { nodownload: value } }).length, 0);
    assert.equal(options('show', { files, is_dark: value }).length, 0);
  }
  assert.equal(options('gd.sbd', { files, metadata: { collection: 'GratefulDead' } }).length, 0);
  assert.equal(options('gd', { files, metadata: { collection: ['GratefulDead'], source: 'Soundboard' } }).length, 0);
});
test('false flags permit downloads; private files suppress incomplete formats', () => {
  assert.equal(options('show', { files, metadata: { nodownload: 'false' } }).length, 2);
  const result = options('show', { files: [...files, { name: 'private.flac', format: 'Flac', private: 'true' }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].format, 'VBR MP3');
  assert.equal(options('show', {}).length, 0);
});
