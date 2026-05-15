/**
 * Dead Radio — continuous random SONG playback.
 * For each song: pick a random artist, pick a random show, play ONE random track.
 * When the song ends, repeat with a fresh random show. Never plays a full set.
 */

const ARTISTS = [
  { name: 'Grateful Dead',     collection: 'GratefulDead',   filterKeyword: null },
  { name: 'Jerry Garcia Band', collection: 'JerryGarcia',    filterKeyword: 'jgb' },
  { name: 'Dead & Company',    collection: 'DeadAndCompany', filterKeyword: null },
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
const eqBars            = document.querySelector('.eq-bars');

let isLoading = false;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  startBtn.addEventListener('click', () => {
    startOverlay.classList.add('is-hidden');
    nowPlayingSection.classList.remove('is-hidden');
    loadRandomSong();
  });

  skipBtn.addEventListener('click', () => {
    if (!isLoading) {
      radioAudio.src = '';
      eqBars?.classList.remove('playing');
      loadRandomSong();
    }
  });

  radioAudio.addEventListener('ended', () => {
    setStatus('Loading next song…');
    setTimeout(loadRandomSong, 600);
  });
  radioAudio.addEventListener('play',  () => eqBars?.classList.add('playing'));
  radioAudio.addEventListener('pause', () => eqBars?.classList.remove('playing'));
  radioAudio.addEventListener('error', () => {
    if (!isLoading) {
      setStatus('Track unavailable — skipping…');
      setTimeout(loadRandomSong, 2000);
    }
  });
});

// ---------------------------------------------------------------------------
// Core loop — one random song per call
// ---------------------------------------------------------------------------
async function loadRandomSong() {
  if (isLoading) return;
  isLoading = true;
  skipBtn.disabled = true;
  setStatus('Tuning in…');

  try {
    // Keep trying until we get a playable track
    while (true) {
      const artist = ARTISTS[Math.floor(Math.random() * ARTISTS.length)];
      const show = await getRandomShow(artist);
      if (!show) { setStatus('Searching…'); await sleep(2000); continue; }

      setStatus('Loading tracks…');
      const { tracks, venue } = await loadTracksAndMeta(show);
      if (!tracks.length) { setStatus('No playable tracks — skipping…'); await sleep(1500); continue; }

      // Pick ONE random track
      const track = tracks[Math.floor(Math.random() * tracks.length)];

      // Update display
      radioArtistName.textContent = artist.name;
      const infoParts = [];
      if (show.date)  infoParts.push(show.date);
      if (venue)      infoParts.push(venue);
      else if (show.title && show.title !== show.identifier) infoParts.push(show.title);
      radioShowInfo.textContent   = infoParts.join(' · ');
      radioShowLink.href          = `https://archive.org/details/${show.identifier}`;
      radioShowLink.textContent   = show.identifier;
      radioTrackName.textContent  = track.displayText;
      setStatus('');

      // Play
      radioAudio.src = track.url;
      radioAudio.play().catch(() => {});
      break;
    }
  } catch (err) {
    console.error(err);
    setStatus('Network error — retrying…');
    setTimeout(loadRandomSong, 5000);
  } finally {
    isLoading = false;
    skipBtn.disabled = false;
  }
}

function setStatus(msg) { radioStatus.textContent = msg; }
function sleep(ms)       { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Internet Archive — show selection
// ---------------------------------------------------------------------------
async function getRandomShow(artist) {
  for (const rows of [1000, 3000, 5000]) {
    const show = await tryRandomShowFromCollection(artist, rows);
    if (show) return show;
  }
  if (artist.filterKeyword) return tryRandomShowByKeyword(artist);
  return null;
}

async function tryRandomShowFromCollection(artist, rows) {
  const url = `https://archive.org/advancedsearch.php?q=collection:${artist.collection}` +
              `&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=${rows}&output=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const docs = filterDocs(data?.response?.docs ?? [], artist.filterKeyword);
  if (!docs.length) return null;
  return docs[Math.floor(Math.random() * docs.length)];
}

async function tryRandomShowByKeyword(artist) {
  const url = `https://archive.org/advancedsearch.php?q=identifier:*${artist.filterKeyword}*` +
              `&fl[]=identifier&fl[]=title&fl[]=date&sort[]=date+desc&rows=500&output=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const docs = filterDocs(data?.response?.docs ?? [], artist.filterKeyword);
  if (!docs.length) return null;
  return docs[Math.floor(Math.random() * docs.length)];
}

function filterDocs(docs, keyword) {
  if (!keyword) return docs;
  const filtered = docs.filter(d =>
    `${d.identifier || ''} ${d.title || ''}`.toLowerCase().includes(keyword.toLowerCase())
  );
  return filtered.length > 0 ? filtered : docs;
}

// ---------------------------------------------------------------------------
// Internet Archive — track loading
// Prefers VBR MP3 → 64Kb MP3 → Ogg Vorbis; returns all tracks in best format.
// ---------------------------------------------------------------------------
async function loadTracksAndMeta(show) {
  const url  = `https://archive.org/metadata/${show.identifier}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Metadata fetch failed (${resp.status})`);
  const data = await resp.json();

  // Venue from IA metadata
  const meta  = data.metadata || {};
  const venue = meta.venue || meta.coverage || '';

  const files = data.files ?? [];
  for (const format of ['VBR MP3', '64Kb MP3', 'Ogg Vorbis']) {
    const candidates = files
      .filter(f => f.format === format && f.name)
      .map(f => ({
        name:        f.name,
        displayText: f.title || f.name,
        url:         `https://archive.org/download/${show.identifier}/${encodeURIComponent(f.name)}`,
      }));
    if (candidates.length) return { tracks: candidates, venue };
  }

  return { tracks: [], venue };
}
