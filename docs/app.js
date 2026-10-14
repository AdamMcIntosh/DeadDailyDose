/**
 * Dead Daily Dose — Web Edition
 * Picks a show for a calendar date (or a specific date) and plays it start to finish.
 * Data source: Internet Archive (archive.org) — no API key required. Depends on archive.js.
 */

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const artistSelect   = document.getElementById('artistSelect');
const dateInput      = document.getElementById('dateInput');
const loadBtn        = document.getElementById('loadBtn');
const statusEl       = document.getElementById('status');
const playerSection  = document.getElementById('playerSection');
const playerCard     = document.getElementById('playerCard');
const showArtistEl   = document.getElementById('showArtist');
const showKindEl     = document.getElementById('showKind');
const showDateEl     = document.getElementById('showDate');
const showVenueEl    = document.getElementById('showVenue');
const showLinkEl     = document.getElementById('showLink');
const showIdEl       = document.getElementById('showId');
const trackCountEl   = document.getElementById('trackCount');
const trackListEl    = document.getElementById('trackList');
const audioEl        = createTransitionPlayer(document.getElementById('audioPlayer'));
const nowPlayingEl   = document.getElementById('nowPlaying');
const nowPlayingMeta = document.getElementById('nowPlayingMeta');
const prevBtn        = document.getElementById('prevBtn');
const nextBtn        = document.getElementById('nextBtn');
const repeatBtn      = document.getElementById('repeatBtn');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const audioTools = createAudioTools(audioEl, document.getElementById('audioTools'));

let current = null; // { artist, show }
let currentTrackIndex = -1;

/** @type {'none'|'all'|'one'} */
let repeatMode = 'none';
const REPEAT_LABELS = { none: '🔁 Repeat', all: '🔁 All', one: '🔂 One' };

/** True when we have a show loaded but playback was blocked by browser autoplay policy. */
let autoplayBlocked = false;

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
function init() {
  ARTISTS.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = a.name;
    artistSelect.appendChild(opt);
  });

  dateInput.value = getTodayMmDd();

  loadBtn.addEventListener('click', loadShowForDate);
  dateInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadShowForDate(); });
  prevBtn.addEventListener('click', playPrev);
  nextBtn.addEventListener('click', playNext);
  repeatBtn.addEventListener('click', cycleRepeatMode);
  audioEl.addEventListener('ended', onTrackEnded);
  audioEl.addEventListener('play',  () => playerCard.classList.add('is-playing'));
  audioEl.addEventListener('pause', () => playerCard.classList.remove('is-playing'));
  audioEl.addEventListener('error', () => {
    if (audioEl.getAttribute('src')) setStatus('This track could not be played.');
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('previoustrack', playPrev);
    navigator.mediaSession.setActionHandler('nexttrack', playNext);
  }

  updateRepeatButton();

  // When autoplay is blocked, one tap anywhere (in response to a user gesture) can start playback
  function tryUnblockPlayback() {
    if (!autoplayBlocked || !current) return;
    autoplayBlocked = false;
    setStatus('');
    audioEl.play().catch(() => {});
  }
  document.addEventListener('click', tryUnblockPlayback);
  document.addEventListener('keydown', tryUnblockPlayback);

  // Auto-load on page open (autoplay may be blocked until the user interacts)
  loadShowForDate();
}

// ---------------------------------------------------------------------------
// Loading a show
// ---------------------------------------------------------------------------
async function loadShowForDate() {
  const artist = ARTISTS[parseInt(artistSelect.value, 10)];
  const date   = parseDateInput(dateInput.value.trim() || getTodayMmDd());
  if (!date) {
    setStatus('Enter a date like 05-08, 08-27-72 or 08-27-1972.');
    return;
  }

  setStatus('Finding a show…', true);
  audioEl.clearQueue();
  audioEl.pause();
  audioEl.removeAttribute('src');
  playerCard.classList.add('is-loading');
  autoplayBlocked = false;

  try {
    const pick = await pickShow(artist, date);
    if (!pick) {
      setStatus('No shows found. Try a different date or artist.');
      return;
    }

    setStatus('Loading setlist…', true);
    const show = await loadShow(pick.identifier);
    if (!show.tracks.length) {
      setStatus('No playable tracks found for this show.');
      return;
    }

    current = { artist: pick.artist, show };
    renderShow(pick, date);
    playerSection.classList.remove('is-hidden');
    setStatus(pick.message || '');
    selectTrack(0, true);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message || 'Network or data error. Please try again.'}`);
  } finally {
    loadBtn.classList.remove('is-loading');
    loadBtn.disabled = false;
    playerCard.classList.remove('is-loading');
  }
}

/** Selected artist on the date → other artists on the date → random show by the selected artist. */
async function pickShow(artist, date) {
  const onDate = await findShowOnDate(artist, date);
  if (onDate) return { artist, identifier: onDate, isRandom: false };

  for (const other of ARTISTS.filter(a => a !== artist)) {
    const id = await findShowOnDate(other, date);
    if (id) {
      return { artist: other, identifier: id, isRandom: false,
               message: `No ${artist.name} show on this date — here's ${other.name} instead.` };
    }
  }

  const randomId = await getRandomShowId(artist);
  return randomId
    ? { artist, identifier: randomId, isRandom: true, message: 'Nothing on this date — enjoy a random show.' }
    : null;
}

/**
 * Returns a recording identifier for the date. Without a year, the featured
 * year rotates each calendar year so the same date doesn't always land on the latest show.
 */
async function findShowOnDate(artist, { mm, dd, year }) {
  const base = `collection:${artist.collection}`;
  const fields = ['identifier', 'date'];

  let docs;
  if (year) {
    const full = `${year}-${mm}-${dd}`;
    ({ docs = [] } = await searchArchive(`${base} AND date:${full}`, { rows: 100, fields }));
    if (!docs.length) {
      const yy = String(year).slice(2);
      ({ docs = [] } = await searchArchive(
        `${base} AND (identifier:*${full}* OR identifier:*${yy}-${mm}-${dd}*)`, { rows: 100, fields }));
      docs = docs.filter(d => docDate(d) === full);
    }
  } else {
    ({ docs = [] } = await searchArchive(`${base} AND identifier:*${mm}-${dd}*`, { rows: 500, fields }));
    docs = docs.filter(d => docDate(d).slice(5) === `${mm}-${dd}`);
  }
  if (!docs.length) return null;

  const dates = [...new Set(docs.map(docDate))].sort();
  const chosenDate = dates[new Date().getFullYear() % dates.length];
  const recordings = docs.filter(d => docDate(d) === chosenDate)
                         .sort((a, b) => a.identifier.localeCompare(b.identifier));
  return (recordings.find(d => /sbd|soundboard/i.test(d.identifier)) || recordings[0]).identifier;
}

function docDate(doc) {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(doc.date || '');
  return m ? m[0] : dateFromIdentifier(doc.identifier);
}

/** Accepts MM-DD, MM-DD-YY or MM-DD-YYYY (with - or / separators). */
function parseDateInput(value) {
  const m = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2}|\d{4}))?$/.exec(value);
  if (!m) return null;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;

  let year = null;
  if (m[3]) {
    // Century pivot: 70-99 → 1970-1999, 00-69 → 2000-2069
    year = m[3].length === 4 ? +m[3] : (+m[3] >= 70 ? 1900 : 2000) + +m[3];
  }
  return { mm, dd, year };
}

// ---------------------------------------------------------------------------
// Rendering & playback
// ---------------------------------------------------------------------------
function renderShow(pick, date) {
  const { artist, show } = current;
  audioTools.setShow(show);

  showArtistEl.textContent = artist.name;
  showKindEl.textContent   = pick.isRandom ? 'Random Show'
                           : date.year     ? 'Show for this date'
                           :                 'Show of the Day';
  showDateEl.textContent   = formatShowDate(show.date);
  showVenueEl.textContent  = [show.venue, show.location].filter(Boolean).join(' · ') || 'Venue unknown';
  showLinkEl.href          = `https://archive.org/details/${show.identifier}`;
  showIdEl.textContent     = show.identifier;
  trackCountEl.textContent = `${show.tracks.length} tracks`;
  renderSetlist(trackListEl, show.tracks, i => selectTrack(i, true));
}

function selectTrack(index, autoPlay) {
  const tracks = current?.show.tracks ?? [];
  if (index < 0 || index >= tracks.length) return;
  currentTrackIndex = index;

  const track = tracks[index];
  nowPlayingEl.textContent   = track.title;
  nowPlayingMeta.textContent = describeTrack(tracks, index);
  highlightSetlist(trackListEl, index);
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === tracks.length - 1;

  document.title = `${track.title} — ${current.artist.name} | Dead Daily Dose`;
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.title,
      artist: current.artist.name,
      album:  [formatShowDate(current.show.date), current.show.venue].filter(Boolean).join(' · '),
    });
  }

  audioEl.src = track.url;
  prepareNextTrack();
  if (autoPlay) {
    audioEl.play()
      .then(() => { autoplayBlocked = false; })
      .catch(() => {
        autoplayBlocked = true;
        setStatus('Tap anywhere to start playback.');
      });
  }
}

function playPrev() {
  if (currentTrackIndex > 0) selectTrack(currentTrackIndex - 1, true);
}

function playNext() {
  const count = current?.show.tracks.length ?? 0;
  if (currentTrackIndex < count - 1) selectTrack(currentTrackIndex + 1, true);
}

function cycleRepeatMode() {
  repeatMode = repeatMode === 'none' ? 'all' : repeatMode === 'all' ? 'one' : 'none';
  updateRepeatButton();
  prepareNextTrack();
}

function updateRepeatButton() {
  repeatBtn.textContent = REPEAT_LABELS[repeatMode];
  repeatBtn.classList.toggle('is-active', repeatMode !== 'none');
  repeatBtn.title = `Repeat: ${repeatMode === 'none' ? 'None' : repeatMode === 'all' ? 'Repeat All' : 'Repeat One'}. Click to cycle.`;
}

function nextTrackIndex() {
  const count = current?.show.tracks.length ?? 0;
  if (!count || currentTrackIndex < 0) return -1;
  if (repeatMode === 'one') return currentTrackIndex;
  if (currentTrackIndex < count - 1) return currentTrackIndex + 1;
  return repeatMode === 'all' ? 0 : -1;
}

function prepareNextTrack() {
  const next = nextTrackIndex();
  audioEl.queue(next < 0 ? null : current.show.tracks[next].url);
}

function onTrackEnded() {
  const next = nextTrackIndex();
  if (next >= 0) selectTrack(next, true);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTodayMmDd() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function setStatus(msg, loading = false) {
  statusEl.textContent = msg;
  loadBtn.classList.toggle('is-loading', loading);
  loadBtn.disabled = loading;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);
