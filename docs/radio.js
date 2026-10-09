/**
 * Dead Radio — continuous random SONG playback.
 * For each song: pick a random artist, pick a random show, play ONE random song.
 * When the song ends, repeat with a fresh random show. Never plays a full set.
 */

const ARTISTS = [
  { name: 'Grateful Dead',  query: 'collection:GratefulDead' },
  { name: 'JGB',            query: 'collection:JGB' },
  { name: 'Dead & Company', query: 'collection:DeadAndCompany' },
];

const IA_SEARCH_URL   = 'https://archive.org/advancedsearch.php';
const IA_MAX_OFFSET   = 10000; // advancedsearch returns nothing past this many results
const AUDIO_FORMATS   = ['VBR MP3', '64Kb MP3', 'Ogg Vorbis'];
const MIN_SONG_SECS   = 45;
const SEGUE_RE        = /\s*(?:-+>|>|→)\s*$/;
const NON_SONG_RE     = /^(?:tuning|crowd|applause|banter|chatter|stage (?:banter|announcements?)|intros?|introductions?|band intros?|dead air|tape (?:flip|change)|silence|noise|announcements?|pa announcements?|sound ?check|set ?break|encore break|filler)\b/i;

// DOM
const startOverlay      = document.getElementById('startOverlay');
const startBtn          = document.getElementById('startBtn');
const nowPlayingSection = document.getElementById('nowPlayingSection');
const radioCard         = document.getElementById('radioCard');
const radioArtistName   = document.getElementById('radioArtistName');
const radioTrackName    = document.getElementById('radioTrackName');
const radioTrackMeta    = document.getElementById('radioTrackMeta');
const radioShowDate     = document.getElementById('radioShowDate');
const radioShowVenue    = document.getElementById('radioShowVenue');
const radioShowLink     = document.getElementById('radioShowLink');
const radioShowId       = document.getElementById('radioShowId');
const radioTrackList    = document.getElementById('radioTrackList');
const radioSetlistCount = document.getElementById('radioSetlistCount');
const radioStatus       = document.getElementById('radioStatus');
const radioAudio        = document.getElementById('radioAudio');
const skipBtn           = document.getElementById('skipBtn');

const showCounts = new Map();
let isLoading    = false;
let current      = null; // { artist, show, index }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  startBtn.addEventListener('click', () => {
    startOverlay.classList.add('is-hidden');
    nowPlayingSection.classList.remove('is-hidden');
    loadRandomSong();
  });

  skipBtn.addEventListener('click', skipSong);

  radioAudio.addEventListener('ended', () => {
    setStatus('Loading next song…');
    setTimeout(loadRandomSong, 600);
  });
  radioAudio.addEventListener('play',  () => radioCard.classList.add('is-playing'));
  radioAudio.addEventListener('pause', () => radioCard.classList.remove('is-playing'));
  radioAudio.addEventListener('error', () => {
    if (!isLoading && radioAudio.getAttribute('src')) {
      setStatus('Track unavailable — skipping…');
      setTimeout(loadRandomSong, 2000);
    }
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('nexttrack', skipSong);
  }
});

function skipSong() {
  if (isLoading) return;
  stopAudio();
  loadRandomSong();
}

function stopAudio() {
  radioAudio.pause();
  radioAudio.removeAttribute('src');
  radioAudio.load();
  radioCard.classList.remove('is-playing');
}

// ---------------------------------------------------------------------------
// Core loop — one random song per call
// ---------------------------------------------------------------------------
async function loadRandomSong() {
  if (isLoading) return;
  isLoading = true;
  skipBtn.disabled = true;
  radioCard.classList.add('is-loading');
  setStatus('Tuning in…');

  try {
    // Keep trying until we get a playable song
    while (true) {
      const artist = ARTISTS[Math.floor(Math.random() * ARTISTS.length)];
      const identifier = await getRandomShowId(artist);
      if (!identifier) { setStatus('Searching…'); await sleep(1500); continue; }

      setStatus('Loading setlist…');
      const show = await loadShow(identifier);
      if (!show.tracks.length) { setStatus('No playable tracks — skipping…'); await sleep(1000); continue; }

      const songs = show.tracks.filter(t => t.isSong);
      const pool  = songs.length ? songs : show.tracks;
      const track = pool[Math.floor(Math.random() * pool.length)];

      current = { artist, show, index: track.index };
      renderShow();
      playCurrent();
      break;
    }
  } catch (err) {
    console.error(err);
    setStatus('Network error — retrying…');
    setTimeout(loadRandomSong, 5000);
  } finally {
    isLoading = false;
    skipBtn.disabled = false;
    radioCard.classList.remove('is-loading');
  }
}

function playTrack(index) {
  if (isLoading || !current) return;
  current.index = index;
  playCurrent();
}

function playCurrent() {
  const { artist, show, index } = current;
  const track = show.tracks[index];
  const next  = show.tracks[index + 1];

  radioTrackName.textContent = track.title;
  const metaParts = [`Track ${index + 1} of ${show.tracks.length}`];
  if (track.duration) metaParts.push(formatDuration(track.duration));
  if (track.segue && next) metaParts.push(`segues into ${next.title}`);
  radioTrackMeta.textContent = metaParts.join(' · ');

  radioTrackList.querySelectorAll('.radio-setlist-item').forEach((li, i) => {
    const active = i === index;
    li.classList.toggle('is-active', active);
    li.querySelector('button').setAttribute('aria-current', active ? 'true' : 'false');
    if (active) radioTrackList.scrollTop = li.offsetTop - radioTrackList.clientHeight / 2 + li.clientHeight / 2;
  });

  document.title = `${track.title} — ${artist.name} | Dead Radio`;
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.title,
      artist: artist.name,
      album:  [formatShowDate(show.date), show.venue].filter(Boolean).join(' · '),
    });
  }

  setStatus('');
  radioAudio.src = track.url;
  radioAudio.play().catch(() => setStatus('Press play to listen.'));
}

function renderShow() {
  const { artist, show } = current;

  radioArtistName.textContent = artist.name;
  radioShowDate.textContent   = formatShowDate(show.date);
  radioShowVenue.textContent  = [show.venue, show.location].filter(Boolean).join(' · ') || 'Venue unknown';
  radioShowLink.href          = `https://archive.org/details/${show.identifier}`;
  radioShowId.textContent     = show.identifier;
  radioSetlistCount.textContent = `${show.tracks.length} tracks`;

  radioTrackList.replaceChildren(...show.tracks.map((track, i) => {
    const li = document.createElement('li');
    li.className = 'radio-setlist-item' + (track.isSong ? '' : ' is-filler');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.addEventListener('click', () => playTrack(i));

    const num = document.createElement('span');
    num.className = 'radio-setlist-num';
    num.textContent = i + 1;

    const title = document.createElement('span');
    title.className = 'radio-setlist-title';
    title.textContent = track.title + (track.segue ? ' →' : '');

    const dur = document.createElement('span');
    dur.className = 'radio-setlist-dur';
    dur.textContent = track.duration ? formatDuration(track.duration) : '';

    btn.append(num, title, dur);
    li.append(btn);
    return li;
  }));
}

function setStatus(msg) { radioStatus.textContent = msg; }
function sleep(ms)       { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Internet Archive — show selection
// Picks a uniformly random item from the whole collection. Offsets past
// IA_MAX_OFFSET are read from the other end of a date-sorted result set.
// ---------------------------------------------------------------------------
async function searchArchive(query, rows, page = 1, sort = null) {
  const params = new URLSearchParams({ q: query, rows, page, output: 'json' });
  params.append('fl[]', 'identifier');
  if (sort) params.append('sort[]', sort);
  const resp = await fetch(`${IA_SEARCH_URL}?${params}`);
  if (!resp.ok) throw new Error(`Search failed (${resp.status})`);
  return (await resp.json()).response ?? {};
}

async function getShowCount(artist) {
  if (!showCounts.has(artist.name)) {
    const { numFound = 0 } = await searchArchive(artist.query, 0);
    showCounts.set(artist.name, numFound);
  }
  return showCounts.get(artist.name);
}

async function getRandomShowId(artist) {
  const total = await getShowCount(artist);
  if (!total) return null;

  const index     = Math.floor(Math.random() * total);
  const fromStart = index < IA_MAX_OFFSET;
  const offset    = Math.min(fromStart ? index : total - 1 - index, IA_MAX_OFFSET - 1);
  const { docs }  = await searchArchive(artist.query, 1, offset + 1, `date ${fromStart ? 'asc' : 'desc'}`);
  return docs?.[0]?.identifier ?? null;
}

// ---------------------------------------------------------------------------
// Internet Archive — show metadata & track list
// ---------------------------------------------------------------------------
async function loadShow(identifier) {
  const resp = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!resp.ok) throw new Error(`Metadata fetch failed (${resp.status})`);
  const data = await resp.json();
  const meta = data.metadata || {};

  return {
    identifier,
    date:     firstValue(meta.date) || dateFromIdentifier(identifier),
    venue:    firstValue(meta.venue) || venueFromTitle(firstValue(meta.title)),
    location: firstValue(meta.coverage),
    tracks:   buildTrackList(identifier, data.files ?? []),
  };
}

function buildTrackList(identifier, files) {
  const byName = new Map(files.map(f => [f.name, f]));

  // Derivatives (Ogg, 64Kb MP3) often lack tags; inherit them from the original file.
  const tag = (file, key) => {
    for (let f = file, depth = 0; f && depth < 4; f = byName.get(f.original), depth++) {
      if (f[key]) return f[key];
    }
    return '';
  };

  for (const format of AUDIO_FORMATS) {
    const audio = files.filter(f => f.format === format && f.name);
    if (!audio.length) continue;

    return audio
      .map(f => {
        const rawTitle = tag(f, 'title') || titleFromFilename(f.name);
        return {
          name:     f.name,
          title:    cleanTitle(rawTitle),
          segue:    SEGUE_RE.test(rawTitle),
          trackNo:  parseInt(tag(f, 'track'), 10),
          duration: parseDuration(tag(f, 'length')),
          url:      `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`,
        };
      })
      .sort(compareTracks)
      .map((t, index) => ({
        ...t,
        index,
        isSong: !NON_SONG_RE.test(t.title) && !(t.duration && t.duration < MIN_SONG_SECS),
      }));
  }
  return [];
}

function compareTracks(a, b) {
  if (Number.isFinite(a.trackNo) && Number.isFinite(b.trackNo) && a.trackNo !== b.trackNo) {
    return a.trackNo - b.trackNo;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

function cleanTitle(raw) {
  return raw
    .replace(SEGUE_RE, '')
    .replace(/^(?:d\d+t\d+|\d{1,2})[\s.)_-]+(?=\S)/i, '')
    .replace(/[*#]+$/, '')
    .replace(/\s+/g, ' ')
    .trim() || raw.trim();
}

function titleFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const m = /t(\d+)$/i.exec(base);
  return m ? `Track ${parseInt(m[1], 10)}` : base.replace(/[_.]+/g, ' ');
}

function venueFromTitle(title) {
  const m = / Live at (.+?) on \d{4}-\d{2}-\d{2}/i.exec(title || '');
  return m && !/^unknown$/i.test(m[1]) ? m[1] : '';
}

function firstValue(v) {
  return (Array.isArray(v) ? v[0] : v) || '';
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function dateFromIdentifier(identifier) {
  const m = /(\d{2}|\d{4})-(\d{2})-(\d{2})/.exec(identifier);
  if (!m) return '';
  let year = m[1];
  if (year.length === 2) year = (Number(year) < 50 ? '20' : '19') + year;
  return `${year}-${m[2]}-${m[3]}`;
}

/** Formats IA dates ("1993-09-28", "1993-09-28T00:00:00Z", "1974-00-00") without timezone drift. */
function formatShowDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw || '');
  if (!m) return raw || 'Date unknown';
  const [year, month, day] = m.slice(1).map(Number);
  if (!month) return String(year);
  if (!day) return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/** IA lengths come as seconds ("409.27") or clock time ("06:49", "1:02:03"). */
function parseDuration(raw) {
  if (!raw) return 0;
  const s = String(raw);
  if (!s.includes(':')) return parseFloat(s) || 0;
  return s.split(':').reduce((acc, part) => acc * 60 + (parseFloat(part) || 0), 0);
}

function formatDuration(secs) {
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
