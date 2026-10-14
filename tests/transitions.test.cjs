const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
class AudioDeck extends EventTarget {
  constructor() { super(); this.volume = 1; this.muted = false; this.playbackRate = 1; this.paused = true; this.loads = 0; this.src = ''; }
  cloneNode() { return new AudioDeck(); }
  after() {}
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loads++; }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
}
function setup() {
  const context = { EventTarget, Event, document: { activeElement: null } };
  vm.createContext(context);
  vm.runInContext(readFileSync('docs/transitions.js', 'utf8'), context);
  const original = new AudioDeck();
  return { player: context.createTransitionPlayer(original), original };
}
test('uses the buffered deck without reloading it and retains volume settings', () => {
  const { player, original } = setup();
  player.src = 'one.mp3';
  player.volume = 0.4; player.muted = true; player.playbackRate = 1.25;
  player.queue('two.mp3');
  const next = player.elements[1];
  const loads = next.loads;
  player.src = 'two.mp3';
  assert.equal(next.loads, loads);
  assert.equal(player.src, 'two.mp3');
  assert.equal(player.volume, 0.4);
  assert.equal(player.muted, true);
  assert.equal(player.playbackRate, 1.25);
  assert.equal(original.hidden, true);
  assert.equal(next.hidden, false);
  assert.equal(original.src, '');
});
test('late events and errors from the idle deck cannot advance playback', () => {
  const { player, original } = setup();
  let ended = 0, errors = 0;
  player.addEventListener('ended', () => ended++);
  player.addEventListener('error', () => errors++);
  player.queue('next'); player.src = 'next';
  original.dispatchEvent(new Event('ended'));
  original.dispatchEvent(new Event('error'));
  assert.equal(ended, 0); assert.equal(errors, 0);
  player.elements[1].dispatchEvent(new Event('ended'));
  assert.equal(ended, 1);
});
test('manual selections discard obsolete buffers; failed preload falls back', () => {
  const { player, original } = setup();
  player.queue('obsolete'); player.src = 'manual';
  assert.equal(original.src, 'manual');
  assert.equal(player.elements[1].src, '');
  player.queue('failed'); player.elements[1].error = {};
  player.src = 'failed';
  assert.equal(original.src, 'failed');
});
test('repeat can preload the same URL and clearing releases the buffer', () => {
  const { player } = setup();
  player.src = 'same'; player.queue('same');
  player.src = 'same';
  assert.equal(player.elements[1].hidden, false);
  player.queue('other'); player.clearQueue();
  assert.equal(player.elements[0].src, '');
});
