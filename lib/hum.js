// Humming to notes: the pitch of each short frame with the YIN method (de Cheveigné and
// Kawahara, 2002), then frames joined into notes where the pitch holds steady, timed in ticks.
import { hzToMidi } from './smf.js';

// Halve the sample rate (averaging pairs, a gentle low-pass) while it is above 24 kHz: humming
// is below 1 kHz, and YIN is quicker on fewer samples.
export function downsample(samples, rate) {
  let x = samples, r = rate;
  while (r > 24000) {
    const y = new Float32Array(x.length >> 1);
    for (let i = 0; i < y.length; i++) y[i] = (x[2 * i] + x[2 * i + 1]) / 2;
    x = y; r /= 2;
  }
  return { samples: x, rate: r };
}

// YIN on one frame: { hz, clarity } (clarity 0..1), or null if no pitch in range.
export function yin(frame, rate, { minHz = 70, maxHz = 1000, threshold = 0.15 } = {}) {
  const tauMin = Math.max(2, Math.floor(rate / maxHz)), tauMax = Math.min(Math.floor(rate / minHz), frame.length >> 1);
  const W = frame.length - tauMax;
  if (W < 32) return null;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = frame[i] - frame[i + tau]; s += v * v; }
    d[tau] = s;
  }
  // cumulative mean normalised difference
  const cm = new Float32Array(tauMax + 1);
  cm[0] = 1; let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cm[t] < threshold) { while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++; tau = t; break; }
  }
  if (tau < 0) { // no dip under the threshold: take the lowest, if it is clear enough
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cm[t] < cm[best]) best = t;
    if (cm[best] > 0.35) return null;
    tau = best;
  }
  // parabolic interpolation around the dip
  const a = cm[tau - 1] ?? cm[tau], b = cm[tau], c = cm[tau + 1] ?? cm[tau];
  const den = a - 2 * b + c;
  const shift = den ? (a - c) / (2 * den) : 0;
  const hz = rate / (tau + Math.max(-1, Math.min(1, shift)));
  return hz >= minHz && hz <= maxHz ? { hz, clarity: 1 - b } : null;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// The pitch track: one entry per hop, { time (s), midi (fractional) | null, level }.
export function pitchTrack(samples, rate, { frame = 1024, hop = 256, gate = 0.1 } = {}) {
  const ds = downsample(samples, rate);
  const x = ds.samples, r = ds.rate;
  const f = Math.round((frame * r) / 22050) || frame, h = Math.round((hop * r) / 22050) || hop;
  const levels = [];
  for (let i = 0; i + f <= x.length; i += h) { let s = 0; for (let j = i; j < i + f; j++) s += x[j] * x[j]; levels.push(Math.sqrt(s / f)); }
  const loud = Math.max(...levels, 0);
  const out = [];
  for (let k = 0, i = 0; i + f <= x.length; i += h, k++) {
    const level = levels[k];
    let midi = null;
    if (level > Math.max(0.005, loud * gate)) { const p = yin(x.subarray(i, i + f), r); if (p) midi = hzToMidi(p.hz); }
    out.push({ time: (i + f / 2) / r, midi, level });
  }
  // a median of 5 frames removes single-frame jumps (octave slips)
  return out.map((p, i) => {
    if (p.midi === null) return p;
    const near = out.slice(Math.max(0, i - 2), i + 3).map((q) => q.midi).filter((m) => m !== null);
    return { ...p, midi: median(near) };
  });
}

// Steady stretches of pitch become notes: a new note starts where the pitch moves more than
// `step` semitones from the note's median and stays moved, or after silence. Notes shorter than
// minDur seconds are dropped. Times are in seconds; Studio turns them into ticks.
export function notesFromTrack(track, { step = 0.7, minDur = 0.08 } = {}) {
  const notes = [];
  let cur = null;
  const close = () => {
    if (cur && cur.end - cur.start >= minDur) {
      const mids = cur.midis;
      const m = median(mids);
      notes.push({ start: cur.start, end: cur.end, pitch: Math.round(m), cents: Math.round((m - Math.round(m)) * 100), level: Math.max(...cur.levels) });
    }
    cur = null;
  };
  const hopT = track.length > 1 ? track[1].time - track[0].time : 0.01;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (p.midi === null) { close(); continue; }
    if (cur) {
      const m = median(cur.midis);
      // moved away, and still moved in the next two frames: a new note
      const ahead = track.slice(i, i + 3).filter((q) => q.midi !== null);
      if (Math.abs(p.midi - m) > step && ahead.length >= 2 && ahead.every((q) => Math.abs(q.midi - m) > step)) close();
    }
    if (!cur) cur = { start: p.time - hopT / 2, end: p.time + hopT / 2, midis: [], levels: [] };
    cur.midis.push(p.midi); cur.levels.push(p.level); cur.end = p.time + hopT / 2;
  }
  close();
  return notes;
}

// Humming to Studio notes (ticks), with velocity from loudness.
export function humToNotes(samples, rate, { bpm = 100, division = 480, offsetSeconds = 0 } = {}) {
  const notes = notesFromTrack(pitchTrack(samples, rate));
  const loud = Math.max(...notes.map((n) => n.level), 1e-6);
  const tick = (s) => Math.max(0, Math.round(((s - offsetSeconds) * bpm / 60) * division));
  return notes.map((n) => ({ tick: tick(n.start), duration: Math.max(1, tick(n.end) - tick(n.start)), pitch: n.pitch, velocity: Math.round(50 + 70 * (n.level / loud)), cents: n.cents }));
}

// A hum for tests and demonstrations: notes [{ midi, dur }] sung as a voiced tone with
// harmonics, vibrato, a slight pitch drift, breath noise and soft gaps between notes.
export function synthHum(notes, rate = 44100, { vibrato = 0.3, drift = 0.15, noise = 0.02, gap = 0.06, seed = 1 } = {}) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const total = notes.reduce((a, n) => a + n.dur + gap, 0.2);
  const out = new Float32Array(Math.ceil(total * rate));
  let t0 = 0.1, phase = 0;
  for (const n of notes) {
    const len = Math.floor(n.dur * rate), start = Math.floor(t0 * rate);
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const semis = n.midi + vibrato * Math.sin(2 * Math.PI * 5.5 * t) + drift * (t / n.dur - 0.5);
      const f = 440 * 2 ** ((semis - 69) / 12);
      phase += (2 * Math.PI * f) / rate;
      const env = Math.min(1, t / 0.03, (n.dur - t) / 0.04);
      const v = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.12 * Math.sin(4 * phase);
      out[start + i] += 0.3 * env * v + noise * rand();
    }
    t0 += n.dur + gap;
  }
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = noise * 0.5 * rand();
  return out;
}
