/**
 * Dead Daily Dose — Web Edition
 * Mirrors the show-selection logic from MainViewModel.cs.
 * Data source: Internet Archive (archive.org) — no API key required.
 */

// ---------------------------------------------------------------------------
// Artist definitions — mirrors MainViewModel.Artists
// ---------------------------------------------------------------------------
const ARTISTS = [
  {
    name: 'Grateful Dead',
    collection: 'GratefulDead',
    collectionFilterKeyword: null,
    excludeKeyword: null,
  },
  {
    name: 'Jerry Garcia Band',
    collection: 'JerryGarcia',
    collectionFilterKeyword: 'jgb',
    excludeKeyword: null,
  },
  {
    name: 'Dead & Company',
    collection: 'DeadAndCompany',
    collectionFilterKeyword: null,
    excludeKeyword: null,
  },
];

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const artistSelect = document.getElementById('artistSelect');
const dateInput = document.getElementById('dateInput');
const loadBtn = document.getElementById('loadBtn');
const statusEl = document.getElementById('status');
const showInfoEl = document.getElementById('showInfo');
const showTitleEl = document.getElementById('showTitle');
const showLinkEl = document.getElementById('showLink');
const trackListEl = document.getElementById('trackList');
const playerSection = document.getElementById('playerSection');
const audioEl = document.getElementById('audioPlayer');
const nowPlayingEl = document.getElementById('nowPlaying');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const repeatBtn = document.getElementById('repeatBtn');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentTracks = [];
let currentTrackIndex = -1;

/** @type {'none'|'all'|'one'} */
let repeatMode = 'none';
const REPEAT_LABELS = { none: 'Repeat', all: '🔁 All', one: '🔁 One' };

/** True when we have a show loaded but playback was blocked by browser autoplay policy. */
let autoplayBlocked = false;

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
function init() {
  // Populate artist dropdown
  ARTISTS.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = a.name;
    artistSelect.appendChild(opt);
  });

  // Default date to today (MM-DD)
  dateInput.value = getTodayMmDd();

  // Wire up events
  loadBtn.addEventListener('click', onLoadClick);
  prevBtn.addEventListener('click', playPrev);
  nextBtn.addEventListener('click', playNext);
  repeatBtn.addEventListener('click', cycleRepeatMode);
  audioEl.addEventListener('ended', onTrackEnded);

  updateRepeatButton();

  // When autoplay is blocked, one tap anywhere (in response to a user gesture) can start playback
  function tryUnblockPlayback() {
    if (!autoplayBlocked || currentTracks.length === 0) return;
    autoplayBlocked = false;
    setStatus('');
    audioEl.play().catch(() => {});
  }
  document.addEventListener('click', tryUnblockPlayback, { once: false });
  document.addEventListener('keydown', tryUnblockPlayback, { once: false });

  // Auto-load on page open (and attempt autoplay; may be blocked until user interacts)
  loadShow();
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------
async function onLoadClick() {
  loadShow();
}

async function loadShow() {
  const artistIndex = parseInt(artistSelect.value, 10);
  const artist = ARTISTS[artistIndex];
  const mmdd = (dateInput.value || getTodayMmDd()).trim();

  setStatus('Loading show…', true);
  showInfoEl.classList.add('is-hidden');
  playerSection.classList.add('is-hidden');
  trackListEl.innerHTML = '';
  currentTracks = [];
  currentTrackIndex = -1;
  autoplayBlocked = false;
  audioEl.src = '';

  try {
    let show = await selectShow(artist, mmdd);

    // If no show for selected artist, try other artists (mirrors C# fallback)
    if (!show) {
      const others = ARTISTS.filter((_, i) => i !== artistIndex);
      for (const other of others) {
        show = await selectShow(other, mmdd);
        if (show) {
          setStatus(`No ${artist.name} show on this date; loaded ${other.name} show.`);
          break;
        }
      }
    }

    if (!show) {
      setStatus(`No shows found. Try a different date or artist.`);
      return;
    }

    // Display show info
    const label = show.isRandom
      ? `${artist.name} — Random Show`
      : `${artist.name} — Show of the Day`;
    showTitleEl.textContent = `${label}: ${show.date ? show.date + ' — ' : ''}${show.title || show.identifier}`;
    showLinkEl.href = `https://archive.org/details/${show.identifier}`;
    showLinkEl.textContent = show.identifier;
    showInfoEl.classList.remove('is-hidden');

    // Load tracks
    setStatus('Loading tracks…', true);
    const tracks = await loadTracks(show);
    currentTracks = tracks;

    if (tracks.length === 0) {
      setStatus('No playable tracks found for this show.');
      return;
    }

    renderTrackList(tracks);
    playerSection.classList.remove('is-hidden');

    setStatus(show.isRandom ? 'Random show loaded.' : 'Ready.');
    // Auto-select and auto-play first track
    selectTrack(0, true);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message || 'Network or data error. Please try again.'}`);
  }
}

// ---------------------------------------------------------------------------
// Show-selection logic — mirrors SelectShowAsync / SearchShowsAsync
// ---------------------------------------------------------------------------

/**
 * Select a show for the given artist and MM-DD date.
 * Mirrors MainViewModel.SelectShowAsync.
 */
async function selectShow(artist, mmdd) {
  const collection = artist.collection;

  // Try 1: date field (date:*-MM-DD)
  let list = await searchShows(artist, `collection:${collection}+AND+date:*-${mmdd}`, 50);

  // Try 2: identifier contains the date string
  if (!list.length) {
    list = await searchShows(artist, `collection:${collection}+AND+identifier:*${mmdd}*`, 100);
  }

  // Try 3: for JGB etc. — search by keyword in identifier across archive
  if (!list.length && artist.collectionFilterKeyword) {
    const kw = artist.collectionFilterKeyword;
    list = await searchShows(artist, `identifier:*${mmdd}*+AND+identifier:*${kw}*`, 100);
  }

  if (list.length > 0) {
    // Sort descending by date; take first — deterministic per day
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const first = list[0];
    return { identifier: first.identifier, title: first.title, date: first.date, isRandom: false };
  }

  // Fallback: random show from collection
  for (const rows of [1000, 3000, 5000]) {
    const show = await tryRandomShowFromCollection(artist, collection, rows);
    if (show) return show;
  }

  // For JGB etc.: random by identifier keyword
  if (artist.collectionFilterKeyword) {
    const show = await tryRandomShowByIdentifierKeyword(artist, artist.collectionFilterKeyword);
    if (show) return show;
  }

  return null;
}

/**
 * Search IA advanced search and return filtered docs.
 * Mirrors MainViewModel.SearchShowsAsync.
 */
async function searchShows(artist, query, rows) {
  const url =
    `https://archive.org/advancedsearch.php?q=${query}` +
    `&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=${rows}&output=json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`IA search failed (${resp.status})`);
  const data = await resp.json();
  const docs = data?.response?.docs ?? [];
  return filterShowsByArtist(docs, artist);
}

/**
 * Try fetching a random show from a collection.
 * Mirrors MainViewModel.TryRandomShowFromCollectionAsync.
 */
async function tryRandomShowFromCollection(artist, collection, rows) {
  const url =
    `https://archive.org/advancedsearch.php?q=collection:${collection}` +
    `&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=${rows}&output=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const docs = data?.response?.docs ?? [];
  const filtered = filterShowsByArtist(docs, artist);
  if (!filtered.length) return null;
  const d = filtered[Math.floor(Math.random() * filtered.length)];
  return { identifier: d.identifier, title: d.title, date: d.date, isRandom: true };
}

/**
 * Try fetching a random show by identifier keyword.
 * Mirrors MainViewModel.TryRandomShowByIdentifierKeywordAsync.
 */
async function tryRandomShowByIdentifierKeyword(artist, keyword) {
  const url =
    `https://archive.org/advancedsearch.php?q=identifier:*${keyword}*` +
    `&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=500&output=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const docs = data?.response?.docs ?? [];
  const filtered = filterShowsByArtist(docs, artist);
  if (!filtered.length) return null;
  const d = filtered[Math.floor(Math.random() * filtered.length)];
  return { identifier: d.identifier, title: d.title, date: d.date, isRandom: true };
}

/**
 * Filter docs by artist include/exclude keywords.
 * Mirrors MainViewModel.FilterShowsByArtist.
 */
function filterShowsByArtist(docs, artist) {
  if (!docs.length) return docs;
  const include = artist.collectionFilterKeyword;
  const exclude = artist.excludeKeyword;
  if (!include && !exclude) return docs;

  const filtered = docs.filter((doc) => {
    const combined = `${doc.identifier || ''} ${doc.title || ''}`.toLowerCase();
    if (exclude && combined.includes(exclude.toLowerCase())) return false;
    if (include && !combined.includes(include.toLowerCase())) return false;
    return true;
  });
  return filtered.length > 0 ? filtered : docs;
}

// ---------------------------------------------------------------------------
// Track loading — mirrors MainViewModel.LoadTracksAsync
// ---------------------------------------------------------------------------

/**
 * Fetch IA metadata and return sorted list of playable tracks.
 * Preferred formats: VBR MP3, 64Kb MP3, Ogg Vorbis (MP3 before Ogg, then by name).
 */
async function loadTracks(show) {
  const url = `https://archive.org/metadata/${show.identifier}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Metadata fetch failed (${resp.status})`);
  const data = await resp.json();
  const files = data.files ?? [];

  const preferred = ['VBR MP3', '64Kb MP3', 'Ogg Vorbis'];
  const candidates = files
    .filter((f) => preferred.includes(f.format) && f.name)
    .map((f) => ({ name: f.name, format: f.format, title: f.title || '' }));

  // Sort: MP3 before Ogg Vorbis, then alphabetically by name (mirrors C# OrderBy)
  candidates.sort((a, b) => {
    const aOgg = a.format === 'Ogg Vorbis' ? 1 : 0;
    const bOgg = b.format === 'Ogg Vorbis' ? 1 : 0;
    if (aOgg !== bOgg) return aOgg - bOgg;
    return a.name.localeCompare(b.name);
  });

  const baseUrl = `https://archive.org/download/${show.identifier}/`;
  return candidates.map((t) => ({
    name: t.name,
    title: t.title,
    url: baseUrl + encodeURIComponent(t.name),
    displayText: t.title || t.name,
  }));
}

// ---------------------------------------------------------------------------
// Track list rendering & playback
// ---------------------------------------------------------------------------
function renderTrackList(tracks) {
  trackListEl.innerHTML = '';
  tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track-item';
    li.dataset.index = i;

    const btn = document.createElement('button');
    btn.className = 'button is-ghost track-btn';
    btn.innerHTML = `<span class="track-num">${i + 1}.</span> <span class="track-title">${escapeHtml(track.displayText)}</span>`;
    btn.addEventListener('click', () => selectTrack(i, true));

    li.appendChild(btn);
    trackListEl.appendChild(li);
  });
}

function selectTrack(index, autoPlay) {
  if (index < 0 || index >= currentTracks.length) return;
  currentTrackIndex = index;

  // Highlight active track
  document.querySelectorAll('.track-item').forEach((el, i) => {
    el.classList.toggle('is-active', i === index);
  });

  const track = currentTracks[index];
  nowPlayingEl.textContent = track.displayText;
  audioEl.src = track.url;
  if (autoPlay) {
    audioEl.play()
      .then(() => { autoplayBlocked = false; setStatus(''); })
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
  if (currentTrackIndex < currentTracks.length - 1) selectTrack(currentTrackIndex + 1, true);
}

function cycleRepeatMode() {
  repeatMode = repeatMode === 'none' ? 'all' : repeatMode === 'all' ? 'one' : 'none';
  updateRepeatButton();
}

function updateRepeatButton() {
  repeatBtn.textContent = REPEAT_LABELS[repeatMode];
  repeatBtn.title = `Repeat: ${repeatMode === 'none' ? 'None' : repeatMode === 'all' ? 'Repeat All' : 'Repeat One'}. Click to cycle.`;
}

function onTrackEnded() {
  if (repeatMode === 'one' && currentTrackIndex >= 0) {
    audioEl.currentTime = 0;
    audioEl.play().catch(() => {});
    return;
  }
  if (currentTrackIndex < currentTracks.length - 1) {
    playNext();
    return;
  }
  if (repeatMode === 'all' && currentTracks.length > 0) {
    selectTrack(0, true);
    return;
  }
  // None and at end: stop (no-op)
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

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);
