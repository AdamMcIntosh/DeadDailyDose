/** Browser-local listening controls. Downloads deliberately retain the source audio. */
function createAudioTools(audio, host) {
  host.innerHTML = `
    <details class="audio-tools">
      <summary>Enhance audio</summary>
      <p class="tools-note">Adjust this recording while listening. Original downloads stay unchanged.</p>
      <button type="button" class="button player-btn" data-toggle aria-pressed="false">Enable enhancement</button>
      <fieldset disabled>
        <label><input type="checkbox" data-rumble checked> Reduce low rumble</label>
        <label>Bass <output data-bass-value>0 dB</output><input aria-label="Bass" data-bass type="range" min="-6" max="6" step="0.5" value="0"></label>
        <label>Clarity <output data-clarity-value>0 dB</output><input aria-label="Clarity" data-clarity type="range" min="-6" max="6" step="0.5" value="0"></label>
        <label>Treble <output data-treble-value>0 dB</output><input aria-label="Treble" data-treble type="range" min="-6" max="6" step="0.5" value="0"></label>
        <label>Balance <output data-balance-value>Center</output><input aria-label="Channel balance" data-balance type="range" min="-1" max="1" step="0.05" value="0"></label>
        <button type="button" class="button player-btn" data-reset>Reset settings</button>
      </fieldset>
      <p class="tools-note" data-enhance-status role="status">Gentle EQ and rumble reduction; no AI processing or added recording detail.</p>
    </details>
    <details class="audio-tools">
      <summary>Download full show</summary>
      <p class="tools-note" data-download-status role="status">Load a show to see downloads.</p>
      <div class="download-options"></div>
      <a data-archive target="_blank" rel="noopener noreferrer" hidden>View files on Archive.org ↗</a>
    </details>`;
  const get = name => host.querySelector(`[data-${name}]`);
  const toggle = get('toggle');
  const status = get('enhance-status');
  const fieldset = host.querySelector('fieldset');
  let context, source, filters, gain, pan, enabled = false;

  function update() {
    for (const key of ['bass', 'clarity', 'treble']) {
      get(`${key}-value`).textContent = `${Number(get(key).value)} dB`;
    }
    const balance = Number(get('balance').value);
    get('balance-value').textContent = balance === 0 ? 'Center' : `${Math.round(Math.abs(balance) * 100)}% ${balance < 0 ? 'left' : 'right'}`;
    if (!context) return;
    const now = context.currentTime;
    filters[0].frequency.setTargetAtTime(get('rumble').checked ? 35 : 0, now, 0.02);
    ['bass', 'clarity', 'treble'].forEach((key, i) => filters[i + 1].gain.setTargetAtTime(Number(get(key).value), now, 0.02));
    // Reserve headroom for positive EQ boosts. No automatic loudness claims.
    const boost = ['bass', 'clarity', 'treble'].reduce((sum, key) => sum + Math.max(0, Number(get(key).value)), 0);
    gain.gain.setTargetAtTime(Math.pow(10, -boost / 20), now, 0.02);
    pan.pan.setTargetAtTime(balance, now, 0.02);
  }

  function route() {
    for (const node of source) {
      node.disconnect();
      node.connect(enabled ? filters[0] : context.destination);
    }
    toggle.textContent = enabled ? 'Listen to original' : 'Enable enhancement';
    toggle.setAttribute('aria-pressed', String(enabled));
    fieldset.disabled = !enabled;
    status.textContent = enabled ? 'Enhancement on. EQ boosts reserve headroom, so playback may be quieter.' : 'Original audio. Enhancement bypassed.';
  }

  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    try {
      if (!context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        context = new AudioContext();
        filters = ['highpass', 'lowshelf', 'peaking', 'highshelf'].map((type, i) => {
          const filter = context.createBiquadFilter();
          filter.type = type;
          filter.frequency.value = [35, 180, 2500, 6000][i];
          filter.Q.value = 0.707;
          return filter;
        });
        gain = context.createGain();
        pan = context.createStereoPanner();
        filters.reduce((prev, next) => { prev.connect(next); return next; });
        filters[3].connect(gain).connect(pan).connect(context.destination);
        source = (audio.elements || [audio]).map(element => context.createMediaElementSource(element));
        source.forEach(node => node.connect(context.destination));
      }
      await context.resume();
      enabled = !enabled;
      update();
      route();
    } catch (error) {
      enabled = false;
      if (source) source.forEach(node => { node.disconnect(); node.connect(context.destination); });
      else { context?.close(); context = null; }
      fieldset.disabled = true;
      toggle.setAttribute('aria-pressed', 'false');
      toggle.textContent = 'Enable enhancement';
      status.textContent = 'Enhancement unavailable in this browser. Try a current browser.';
    } finally { toggle.disabled = false; }
  });
  audio.addEventListener('play', () => { context?.resume().catch(() => { status.textContent = 'Tap the enhancement button to resume audio processing.'; }); });
  audio.addEventListener('error', event => {
    // Keep ordinary playback available when a host does not allow CORS.
    // Once a media element is attached to Web Audio it cannot be detached.
    if (!source && audio.hasAttribute('crossorigin') && audio.getAttribute('src')) {
      event.stopImmediatePropagation();
      audio.removeAttribute('crossorigin');
      toggle.disabled = true;
      status.textContent = 'Retrying original playback. Enhancement is unavailable for this stream; reload the page to try again.';
      audio.load();
      audio.play().catch(() => {});
      return;
    }
    status.textContent = 'This stream could not load. Try another track or open the recording on Archive.org.';
  });
  fieldset.addEventListener('input', update);
  get('reset').addEventListener('click', () => {
    ['bass', 'clarity', 'treble', 'balance'].forEach(key => { get(key).value = '0'; });
    get('rumble').checked = true;
    update();
  });
  if (!(window.AudioContext || window.webkitAudioContext)) {
    toggle.disabled = true;
    status.textContent = 'Audio enhancement is not supported in this browser.';
  }

  return {
    setShow(show) {
      const container = host.querySelector('.download-options');
      container.replaceChildren();
      const options = show.downloads || [];
      get('download-status').textContent = options.length
        ? 'Save every audio file in the selected format, including breaks and tuning. Your browser manages progress and cancellation. Downloads contain original audio.'
        : 'No downloadable audio is available for this recording. It may be streaming-only or restricted.';
      get('archive').hidden = false;
      get('archive').href = `https://archive.org/details/${encodeURIComponent(show.identifier)}`;
      for (const option of options) {
        const link = document.createElement('a');
        link.className = 'button player-btn';
        link.href = option.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const size = option.bytes ? ` · ${(option.bytes / 1024 ** 2).toFixed(0)} MB` : '';
        link.textContent = `${option.format} · ${option.count} files${size}`;
        link.addEventListener('click', () => {
          get('download-status').textContent = 'Download requested from Archive.org. ZIP preparation can take a moment. If it fails, use “View files on Archive.org” to retry or download individual files.';
        });
        container.append(link);
      }
    },
  };
}
