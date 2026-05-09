/**
 * Dead Radio — continuous random show playback
 * Picks a random artist + show from the Internet Archive and plays forever.
 * When a show ends, a new random show (random artist) loads automatically.
 */

const ARTISTS = [
  { name: 'Grateful Dead',   collection: 'GratefulDead',    collectionFilterKeyword: null,  excludeKeyword: null },
  { name: 'Jerry Garcia Band', collection: 'JerryGarcia',   collectionFilterKeyword: 'jgb', excludeKeyword: null },
  { name: 'Dead & Company',  collection: 'DeadAndCompany',  collectionFilterKeyword: null,  excludeKeyword: null },
];

// DOM
const startOverlay      = document.getElementById('startOverlay');
const startBtn          = document.getElementById('startBtn');
const nowPlayingSection = document.getElementById('nowPlayingSection');
const radioArtistName   = document.getElementById('radioArtistName');
const radioShowInfo     = document.getElementById('radioShowInfo');
const radioShowLink     = document.getElementById('radioShowLink');
const radioTrackName    = document.getElementById('radioTrackName');
const radioStatus       = document.getElementById('radioStatus');
const radioAudio        = document.getElementById('radioAudio');
const skipBtn           = document.getElementById('skipBtn');
const radioTrackList    = document.getElementById('radioTrackList');
const eqBars            = document.querySelector('.eq-bars');

// State
let currentTracks      = [];
let currentTrackIndex  = -1;
let isLoading          = false;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  startBtn.addEventListener('click', () => {
    startOverlay.classList.add('is-hidden');
    nowPlayingSection.classList.remove('is-hidden');
    loadRandomShow();
  });

  skipBtn.addEventListener('click', () => {
    if (!isLoading) loadRandomShow();
  });

  radioAudio.addEventListener('ended', onTrackEnded);
  radioAudio.addEventListener('play',  () => eqBars?.classList.add('playing'));
  radioAudio.addEventListener('pause', () => eqBars?.classList.remove('playing'));
});

// ---------------------------------------------------------------------------
// Core radio loop
// ---------------------------------------------------------------------------
async function loadRandomShow() {
  if (isLoading) return;
  isLoading = true;
  skipBtn.disabled = true;

  currentTracks = [];
  currentTrackIndex = -1;
  radioAudio.src = '';
  radioTrackList.innerHTML = '';
  eqBars?.classList.remove('playing');
  setStatus('Tuning in…');

  try {
    const artist = ARTISTS[Math.floor(Math.random() * ARTISTS.length)];
    const show = await getRandomShow(artist);

    if (!show) {
      setStatus('Could not find a show — retrying…');
      isLoading = false;
      skipBtn.disabled = false;
      setTimeout(loadRandomShow, 3000);
      return;
    }

    radioArtistName.textContent = artist.name;
    radioShowInfo.textContent   = show.date
      ? `${show.date} — ${show.title || show.identifier}`
      : (show.title || show.identifier);
    radioShowLink.href        = `https://archive.org/details/${show.identifier}`;
    radioShowLink.textContent = show.identifier;

    setStatus('Loading tracks…');
    const tracks = await loadTracks(show);

    if (!tracks.length) {
      setStatus('No playable tracks — skipping…');
      isLoading = false;
      skipBtn.disabled = false;
      setTimeout(loadRandomShow, 2000);
      return;
    }

    currentTracks = tracks;
    renderTrackList(tracks);
    isLoading = false;
    skipBtn.disabled = false;
    setStatus('');
    selectTrack(0);
  } catch (err) {
    console.error(err);
    setStatus('Network error — retrying…');
    isLoading = false;
    skipBtn.disabled = false;
    setTimeout(loadRandomShow, 5000);
  }
}

function onTrackEnded() {
  if (currentTrackIndex < currentTracks.length - 1) {
    selectTrack(currentTrackIndex + 1);
  } else {
    setStatus('Show complete — loading next show…');
    setTimeout(loadRandomShow, 1500);
  }
}

function selectTrack(index) {
  currentTrackIndex = index;
  const track = currentTracks[index];
  radioTrackName.textContent = track.displayText;
  radioAudio.src = track.url;
  radioAudio.play().catch(() => {});

  document.querySelectorAll('.radio-track-item').forEach((el, i) => {
    el.classList.toggle('is-active', i === index);
  });
}

function renderTrackList(tracks) {
  radioTrackList.innerHTML = '';
  tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track-item radio-track-item';

    const btn = document.createElement('button');
    btn.className = 'button is-ghost track-btn';
    btn.innerHTML = `<span class="track-num">${i + 1}.</span> <span class="track-title">${escapeHtml(track.displayText)}</span>`;
    btn.addEventListener('click', () => selectTrack(i));

    li.appendChild(btn);
    radioTrackList.appendChild(li);
  });
}

function setStatus(msg) {
  radioStatus.textContent = msg;
}

// ---------------------------------------------------------------------------
// Internet Archive helpers (mirrors app.js)
// ---------------------------------------------------------------------------
async function getRandomShow(artist) {
  for (const rows of [1000, 3000, 5000]) {
    const show = await tryRandomShowFromCollection(artist, artist.collection, rows);
    if (show) return show;
  }
  if (artist.collectionFilterKeyword) {
    return tryRandomShowByIdentifierKeyword(artist, artist.collectionFilterKeyword);
  }
  return null;
}

async function tryRandomShowFromCollection(artist, collection, rows) {
  const url =
    `https://archive.org/advancedsearch.php?q=collection:${collection}` +
    `&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=${rows}&output=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const docs = filterShowsByArtist(data?.response?.docs ?? [], artist);
  if (!docs.length) return null;
  const d = docs[Math.floor(Math.random() * docs.length)];
  return { identifier: d.identifier, title: d.title, date: d.date };
}

async function tryRandomShowByIdentifierKeyword(artist, keyword) {
  const url =
    `https://archive.org/advancedsearch.php?q=identifier:*${keyword}*` +
    `&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=500&output=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const docs = filterShowsByArtist(data?.response?.docs ?? [], artist);
  if (!docs.length) return null;
  const d = docs[Math.floor(Math.random() * docs.length)];
  return { identifier: d.identifier, title: d.title, date: d.date };
}

function filterShowsByArtist(docs, artist) {
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

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
