// Sounds in the browser (Web Audio): plucked strings for guitar tracks (Karplus-Strong),
// a sung vowel for lyric tracks (a buzz through three formant filters), and LucianOS's General
// MIDI voices (/shared/gm.js) for everything else.
import { midiToHz } from './smf.js';
import { VOWELS, vowelOf } from './parts.js';

const plucks = new Map(); // cached string sounds, by sample rate and pitch
function pluckBuffer(ctx, pitch, seconds = 2.5) {
  const key = `${ctx.sampleRate}:${pitch}`;
  if (plucks.has(key)) return plucks.get(key);
  const rate = ctx.sampleRate, n = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, n, rate), out = buf.getChannelData(0);
  const period = Math.max(2, Math.round(rate / midiToHz(pitch)));
  const line = new Float32Array(period);
  let seed = pitch * 7919;
  for (let i = 0; i < period; i++) { seed = (seed * 16807) % 2147483647; line[i] = (seed / 2147483647) * 2 - 1; }
  const decay = 0.996 - Math.max(0, pitch - 40) * 0.0002;
  for (let i = 0, j = 0; i < n; i++, j = (j + 1) % period) {
    const next = (j + 1) % period;
    out[i] = line[j];
    line[j] = decay * 0.5 * (line[j] + line[next]);
  }
  plucks.set(key, buf);
  return buf;
}

export function playPluck(ctx, out, n, t) {
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, n.pitch);
  const g = ctx.createGain();
  const vel = (n.velocity ?? 90) / 127;
  g.gain.setValueAtTime(0.35 * vel, t);
  g.gain.setTargetAtTime(0, t + Math.max(0.05, n.duration), 0.08);
  src.connect(g); g.connect(out.dry); g.connect(out.rev);
  src.start(t); src.stop(t + n.duration + 0.6);
}

export function playVoice(ctx, out, n, t) {
  const f0 = midiToHz(n.pitch);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  // a little vibrato after the start, as a singer does
  const lfo = ctx.createOscillator(), depth = ctx.createGain();
  lfo.frequency.value = 5.5; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(f0 * 0.012, t + 0.3);
  lfo.connect(depth); depth.connect(osc.frequency);
  const env = ctx.createGain();
  const vel = (n.velocity ?? 90) / 127;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.22 * vel, t + 0.05);
  env.gain.setValueAtTime(0.22 * vel, t + Math.max(0.06, n.duration - 0.06));
  env.gain.linearRampToValueAtTime(0, t + n.duration + 0.05);
  const [f1, f2, f3] = VOWELS[vowelOf(n.lyric ?? 'a')];
  for (const [f, q, gain] of [[f1, 8, 1], [f2, 10, 0.5], [f3, 12, 0.25]]) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    osc.connect(bp); bp.connect(g); g.connect(env);
  }
  env.connect(out.dry); env.connect(out.rev);
  osc.start(t); lfo.start(t); osc.stop(t + n.duration + 0.1); lfo.stop(t + n.duration + 0.1);
}

// A player for a list of notes in seconds: { stop(), done }. Notes are scheduled a little ahead.
export async function playNotes(notes, { onTime, from = 0 } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume?.();
  const [{ mixer }, gm] = await Promise.all([import('/shared/midi.js'), import('/shared/gm.js')]);
  const out = mixer(ctx);
  out.master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.12 - from;
  const end = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  const list = notes.filter((n) => n.time + n.duration > from).sort((a, b) => a.time - b.time);
  let next = 0, finish, stopped = false;
  const done = new Promise((r) => { finish = r; });
  const timer = setInterval(() => {
    const now = ctx.currentTime - t0;
    while (next < list.length && list[next].time < now + 0.5) {
      const n = list[next++];
      if (n.time < now - 0.05) continue;
      const when = t0 + n.time;
      if (n.kind === 'guitar') playPluck(ctx, out, n, when);
      else if (n.kind === 'vocal') playVoice(ctx, out, n, when);
      else (n.channel === 9 ? gm.playDrum : gm.playNote)(ctx, out, n, when);
    }
    onTime?.(now);
    if (now > end + 1) stop();
  }, 50);
  function stop() { if (stopped) return; stopped = true; clearInterval(timer); ctx.close().catch(() => {}); finish(); }
  return { stop, done };
}

// Record from the microphone until stopped: { stop() -> Promise<{ samples, rate }> }.
export async function recordMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume?.();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc); proc.connect(ctx.destination);
  return {
    rate: ctx.sampleRate,
    async stop() {
      proc.disconnect(); src.disconnect();
      for (const t of stream.getTracks()) t.stop();
      const rate = ctx.sampleRate;
      await ctx.close().catch(() => {});
      const len = chunks.reduce((a, c) => a + c.length, 0);
      const samples = new Float32Array(len);
      let o = 0; for (const c of chunks) { samples.set(c, o); o += c.length; }
      return { samples, rate };
    }
  };
}
