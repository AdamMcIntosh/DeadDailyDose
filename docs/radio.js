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
const radioAudio        = createTransitionPlayer(document.getElementById('radioAudio'));
const skipBtn           = document.getElementById('skipBtn');

let isLoading = false;
const audioTools = createAudioTools(radioAudio, document.getElementById('audioTools'));

let current   = null; // { artist, show, index }
let upcoming = null;
let retryTimer = null;

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
    loadRandomSong();
  });
  radioAudio.addEventListener('play',  () => radioCard.classList.add('is-playing'));
  radioAudio.addEventListener('pause', () => radioCard.classList.remove('is-playing'));
  radioAudio.addEventListener('error', () => {
    if (!isLoading && radioAudio.getAttribute('src')) {
      setStatus('Track unavailable — skipping…');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(loadRandomSong, 2000);
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

  clearTimeout(retryTimer);
  try {
    const next = await (upcoming || findRandomSong());
    upcoming = null;
    if (!next) throw new Error('No playable show found');
    current = next;
    renderShow();
    playCurrent();
  } catch (err) {
    upcoming = null;
    console.error(err);
    setStatus('Network error — retrying…');
    retryTimer = setTimeout(loadRandomSong, 5000);
  } finally {
    isLoading = false;
    skipBtn.disabled = false;
    radioCard.classList.remove('is-loading');
  }
}

async function findRandomSong() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const artist = ARTISTS[Math.floor(Math.random() * ARTISTS.length)];
    const identifier = await getRandomShowId(artist);
    if (!identifier) continue;
    const show = await loadShow(identifier);
    if (!show.tracks.length) continue;
    const songs = show.tracks.filter(t => t.isSong);
    const pool = songs.length ? songs : show.tracks;
    const track = pool[Math.floor(Math.random() * pool.length)];
    return { artist, show, index: track.index };
  }
  return null;
}

function prepareRadioSong() {
  if (upcoming) return;
  // A failed speculative lookup must not interrupt the song currently playing.
  upcoming = findRandomSong().then(next => {
    if (next) radioAudio.queue(next.show.tracks[next.index].url);
    return next;
  }).catch(() => null);
}

function playTrack(index) {
  if (isLoading || !current) return;
  clearTimeout(retryTimer);
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
  // Selecting a setlist track may have cleared the buffered deck. Restore it.
  if (upcoming) upcoming.then(next => {
    if (next) radioAudio.queue(next.show.tracks[next.index].url);
  });
  else prepareRadioSong();
}

function renderShow() {
  const { artist, show } = current;
  audioTools.setShow(show);

  radioArtistName.textContent   = artist.name;
  radioShowDate.textContent     = formatShowDate(show.date);
  radioShowVenue.textContent    = [show.venue, show.location].filter(Boolean).join(' · ') || 'Venue unknown';
  radioShowLink.href            = `https://archive.org/details/${show.identifier}`;
  radioShowId.textContent       = show.identifier;
  radioSetlistCount.textContent = `${show.tracks.length} tracks`;
  renderSetlist(radioTrackList, show.tracks, playTrack);
}

function setStatus(msg) { radioStatus.textContent = msg; }
