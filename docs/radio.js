/**
 * Dead Radio — continuous random SONG playback.
 * For each song: pick a random artist, pick a random show, play ONE random song.
 * When the song ends, repeat with a fresh random show. Never plays a full set.
 * Depends on archive.js.
 */

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

let isLoading = false;
let current   = null; // { artist, show, index }

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

  radioTrackName.textContent = track.title;
  radioTrackMeta.textContent = describeTrack(show.tracks, index);
  highlightSetlist(radioTrackList, index);

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

  radioArtistName.textContent   = artist.name;
  radioShowDate.textContent     = formatShowDate(show.date);
  radioShowVenue.textContent    = [show.venue, show.location].filter(Boolean).join(' · ') || 'Venue unknown';
  radioShowLink.href            = `https://archive.org/details/${show.identifier}`;
  radioShowId.textContent       = show.identifier;
  radioSetlistCount.textContent = `${show.tracks.length} tracks`;
  renderSetlist(radioTrackList, show.tracks, playTrack);
}

function setStatus(msg) { radioStatus.textContent = msg; }
function sleep(ms)       { return new Promise(r => setTimeout(r, ms)); }
