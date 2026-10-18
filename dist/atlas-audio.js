// Original, browser-generated sounds. Audio starts only after an explicit gesture.
const key = 'atlas-sound-v1';
let enabled = false;
try { enabled = localStorage.getItem(key) === 'on'; } catch {}
let context, master, analyser, compressor, noise, ambience = [], lastAt = -Infinity, lastCue = '', cues = 0;
const voices = new Set();
const scene = document.body.dataset.view || 'world';
const button = document.createElement('button');
button.id = 'sound-button'; button.className = 'icon-button sound-button'; button.type = 'button';
button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10h4l5-4v12l-5-4H4z"/><g class="sound-waves"><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></g><path class="sound-slash" d="m16 9 5 6m0-6-5 6"/></svg>';
document.querySelector('.header-actions')?.prepend(button);
function paint() {
  button.setAttribute('aria-pressed', String(enabled));
  button.title = button.ariaLabel = enabled ? '关闭音效与空间氛围' : '开启音效与空间氛围';
  document.body.classList.toggle('sound-enabled', enabled);
}
paint();
button.addEventListener('keydown', event => {
  if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
});
function create() {
  if (context) return true;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) { button.title = button.ariaLabel = '当前浏览器不支持音效'; button.disabled = true; return false; }
  context = new Audio(); master = context.createGain(); master.gain.value = .5;
  compressor = context.createDynamicsCompressor(); compressor.threshold.value = -16; compressor.knee.value = 18;
  compressor.ratio.value = 5; compressor.attack.value = .006; compressor.release.value = .25;
  analyser = context.createAnalyser(); analyser.fftSize = 512;
  master.connect(compressor); compressor.connect(analyser); analyser.connect(context.destination);
  noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = noise.getChannelData(0); for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return true;
}
function track(source, nodes) {
  const voice = { source, nodes }; voices.add(voice);
  source.onended = () => { voices.delete(voice); source.disconnect(); for (const n of nodes) n.disconnect(); };
}
function tone(frequency, delay = 0, duration = .5, level = .15, end = frequency, pan = 0) {
  const at = context.currentTime + delay, source = context.createOscillator(), gain = context.createGain(), stereo = context.createStereoPanner();
  source.type = 'sine'; source.frequency.setValueAtTime(frequency, at); source.frequency.exponentialRampToValueAtTime(end, at + duration);
  gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .018); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
  stereo.pan.value = pan; source.connect(gain); gain.connect(stereo); stereo.connect(master);
  track(source, [gain, stereo]); source.start(at); source.stop(at + duration + .02);
}
function sweep(duration, level, from, to) {
  const at = context.currentTime, source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain(), stereo = context.createStereoPanner();
  source.buffer = noise; source.loop = true; filter.type = 'bandpass'; filter.Q.value = .8;
  filter.frequency.setValueAtTime(from, at); filter.frequency.exponentialRampToValueAtTime(to, at + duration * .8);
  gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + duration * .35); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
  stereo.pan.setValueAtTime(-.65, at); stereo.pan.linearRampToValueAtTime(.65, at + duration);
  source.connect(filter); filter.connect(gain); gain.connect(stereo); stereo.connect(master);
  track(source, [filter, gain, stereo]); source.start(); source.stop(at + duration + .02);
}
function startAmbience() {
  if (ambience.length) return;
  // A quiet open fifth, with slow breathing rather than a repetitive music loop.
  const base = scene === 'galaxy' ? 55 : scene === 'globe' ? 65.406 : 73.416;
  for (const [i, ratio] of [1, 1.5, 2].entries()) {
    const source = context.createOscillator(), gain = context.createGain(), lfo = context.createOscillator(), depth = context.createGain();
    source.frequency.value = base * ratio; gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(.025 / (i + 1), context.currentTime + 2);
    lfo.frequency.value = .035 + i * .013; depth.gain.value = .005 / (i + 1);
    lfo.connect(depth); depth.connect(gain.gain); source.connect(gain); gain.connect(master); source.start(); lfo.start();
    ambience.push({ source, gain, lfo, depth });
  }
}
function stopAmbience() {
  for (const {source, gain, lfo, depth} of ambience) { source.stop(); lfo.stop(); source.disconnect(); gain.disconnect(); lfo.disconnect(); depth.disconnect(); }
  ambience = [];
}
function clearVoices() {
  for (const {source, nodes} of voices) {
    source.onended = null; try { source.stop(); } catch {}
    source.disconnect(); for (const node of nodes) node.disconnect();
  }
  voices.clear();
}
async function unlock() {
  if (!enabled || document.hidden) return false;
  try { if (!create()) return false; await context.resume(); if (!enabled || document.hidden) return false; startAmbience(); return context.state === 'running'; }
  catch { return false; }
}
function play(name = 'tick', city) {
  if (!enabled || document.hidden) return;
  if (context?.state !== 'running') {
    if (navigator.userActivation?.hasBeenActive) void unlock().then(active => { if (active) play(name, city); });
    return;
  }
  const now = performance.now(); if (now - lastAt < (name === 'tick' ? 130 : 75)) return;
  lastAt = now; lastCue = name; cues++;
  if (name === 'city') {
    const notes = [392, 440, 523.25, 587.33, 659.25], f = notes[Math.abs(Math.round(city?.lon || 0)) % notes.length];
    tone(f, 0, .48, .17, f, -.24); tone(f * 1.5, .095, .75, .1, f * 1.5, .24);
  } else if (name === 'meteor') {
    sweep(1.8, .23, 2300, 280); tone(1174.66, .12, 1.1, .075, 587.33, -.3);
  } else if (name === 'warp') {
    sweep(4.8, .38, 90, 4500); tone(55, 0, 4.5, .15, 220);
    tone(880, 3.75, 1, .11, 1320, .35); tone(1320, 4, .8, .06);
  } else if (name === 'view' || name === 'open' || name === 'tour') {
    tone(261.63, 0, .5, .12); tone(392, .085, .65, .1); tone(523.25, .17, .8, .07);
  } else tone(880, 0, .13, .065, 660);
}
button.addEventListener('click', async () => {
  enabled = !enabled; paint(); try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch {}
  if (enabled) {
    if (await unlock()) play('open');
    else { enabled = false; paint(); }
  } else if (context) {
    clearVoices(); stopAmbience(); await context.suspend();
  }
});
// Remember preference across views, while respecting browser autoplay restrictions.
document.addEventListener('pointerdown', event => { if (!button.contains(event.target)) void unlock(); }, {capture:true});
document.addEventListener('keydown', event => { if (!event.repeat && !button.contains(event.target)) void unlock(); }, {capture:true});
document.addEventListener('click', event => {
  if (!button.contains(event.target) && event.target.closest('button,a,summary')) play('tick');
});
document.addEventListener('change', event => { if (event.target.matches('input[type="checkbox"]')) play('tick'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && context) { clearVoices(); void context.suspend(); }
  else if (enabled && context) void unlock();
});
window.addEventListener('pagehide', () => { clearVoices(); if (context) void context.suspend(); });
window.atlasAudioStatus = () => {
  let rms = 0;
  if (analyser) { const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values); rms = Math.sqrt(values.reduce((sum,v) => sum + v*v, 0) / values.length); }
  return {enabled, state:context?.state || 'uninitialized', scene, lastCue, cues, voices:voices.size, ambience:ambience.length, rms};
};
export const sound = {play};
export function revealDestination(element) {
  if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.getAnimations().forEach(animation => animation.cancel());
  element.animate([{opacity:.4,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}], {duration:480,easing:'cubic-bezier(.2,.7,.2,1)'});
}
