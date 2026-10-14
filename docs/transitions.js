/** Two media decks: buffer the next track while the current one plays.
 * No overlap or trimming: live-show segues retain their recorded timing.
 * Media-element handoffs reduce loading gaps but are not sample-accurate.
 */
function createTransitionPlayer(element) {
  const spare = element.cloneNode(false);
  spare.removeAttribute('id');
  spare.removeAttribute('src');
  spare.hidden = true;
  element.after(spare);
  const decks = [element, spare];
  decks.forEach(deck => { deck.preload = 'auto'; });
  const events = new EventTarget();
  let active = element;
  let queued = null;
  const idle = () => decks.find(deck => deck !== active);
  function clearQueue() {
    queued = null;
    const next = idle();
    next.pause();
    next.removeAttribute('src');
    next.load();
  }
  function queue(url) {
    if (!url) { clearQueue(); return; }
    if (queued === url) return;
    queued = url;
    const next = idle();
    next.src = url;
    next.load();
  }
  function select(url) {
    if (url === queued && !idle().error) {
      const old = active;
      const next = idle();
      next.volume = old.volume;
      next.muted = old.muted;
      next.playbackRate = old.playbackRate;
      const focused = document.activeElement === old;
      active = next; // Ignore late pause/ended/error events from the outgoing deck.
      old.pause();
      old.hidden = true;
      next.hidden = false;
      if (focused) next.focus();
      clearQueue();
    } else {
      clearQueue();
      active.src = url;
    }
  }
  for (const deck of decks) {
    for (const type of ['play', 'pause', 'ended', 'error', 'timeupdate', 'loadedmetadata', 'canplay', 'seeking', 'seeked', 'volumechange', 'ratechange']) {
      deck.addEventListener(type, () => {
        if (deck === active) events.dispatchEvent(new Event(type));
      });
    }
  }
  // Stable player reference keeps controls and enhancement listeners on both decks.
  return new Proxy(events, {
    get(target, key) {
      if (key === 'elements') return decks;
      if (key === 'queue') return queue;
      if (key === 'clearQueue') return clearQueue;
      if (key in target) {
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }
      const value = active[key];
      return typeof value === 'function' ? value.bind(active) : value;
    },
    set(target, key, value) {
      if (key === 'src') select(value);
      else active[key] = value;
      return true;
    },
  });
}
