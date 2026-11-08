// A Studio project: tracks, and clips of MIDI notes ("samples") placed on them, which may
// overlap. Each clip can carry a tag and a note on how to interpret it, written beside the MIDI
// when it is exported. Times are in ticks (division per beat).

export const TAGS = { '': 'No tag', background: 'Background music', sound: 'Sound effect', vocal: 'Vocal effect', expand: 'Expand in Music-Composer' };
export const GRIDS = { off: 'No snap', bar: 'Bar', beat: 'Beat', '1/2': 'Half beat', '1/3': 'Triplet', '1/4': 'Quarter beat', '1/8': 'Eighth of a beat' };
export const KINDS = { midi: 'MIDI', guitar: 'Guitar', vocal: 'Sung lyrics', hum: 'Humming' };

let seq = 0;
export const newId = (p = 'x') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newProject({ bpm = 100, num = 4, den = 4, division = 480 } = {}) {
  return { division, bpm, num, den, grid: 'beat', zoom: 100, tracks: [{ id: 't1', name: 'Piano', kind: 'midi', program: 0, channel: 0, mute: false }], clips: [] };
}

export const ticksPerBeat = (p) => p.division * (4 / p.den);
export const ticksPerBar = (p) => ticksPerBeat(p) * p.num;
export const gridTicks = (p, grid = p.grid) => {
  const beat = ticksPerBeat(p);
  return { off: 1, bar: ticksPerBar(p), beat, '1/2': beat / 2, '1/3': beat / 3, '1/4': beat / 4, '1/8': beat / 8 }[grid] ?? beat;
};
export const seconds = (p, tick) => (tick / p.division) * (60 / p.bpm);
export const ticksAt = (p, secs) => (secs * p.bpm / 60) * p.division;
// "3.2" = bar 3, beat 2 (both from 1)
export function barBeat(p, tick) {
  const bar = Math.floor(tick / ticksPerBar(p)) + 1;
  const beat = Math.floor((tick % ticksPerBar(p)) / ticksPerBeat(p)) + 1;
  return `${bar}.${beat}`;
}
export const pxPerTick = (p) => (40 * (p.zoom / 100)) / ticksPerBeat(p); // 40 px a beat at 100%

export const snap = (p, tick, grid = p.grid) => { const g = gridTicks(p, grid); return Math.max(0, Math.round(tick / g) * g); };

// Shift-drag: line the clip up with the nearest bar line or edge of another clip (the ruler),
// if one is within `within` ticks; otherwise snap to the grid.
export function align(p, tick, { clipId = null, length = 0, within = null } = {}) {
  const near = within ?? ticksPerBeat(p) / 2;
  const edges = [];
  for (const c of p.clips) if (c.id !== clipId) edges.push(c.start, c.start + clipLength(p, c));
  const bar = ticksPerBar(p);
  edges.push(Math.round(tick / bar) * bar, Math.round((tick + length) / bar) * bar - length);
  let best = null;
  for (const e of edges) {
    for (const cand of [e, e - length]) { // our start, or our end, on the edge
      const d = Math.abs(cand - tick);
      if (cand >= 0 && d <= near && (best === null || d < best.d)) best = { t: cand, d };
    }
  }
  return best ? best.t : snap(p, tick);
}

// A clip's length: what it says, or the end of its last note, rounded up to a beat.
export function clipLength(p, c) {
  if (c.length) return c.length;
  const end = c.notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0);
  const beat = ticksPerBeat(p);
  return Math.max(beat, Math.ceil(end / beat) * beat);
}
export const projectLength = (p) => p.clips.reduce((m, c) => Math.max(m, c.start + clipLength(p, c)), 0);

// Quantise: move each note toward the nearest grid line (strength 1 = all the way), and with
// ends, round its length to whole grid steps (at least one).
export function quantise(notes, g, { strength = 1, ends = true } = {}) {
  return notes.map((n) => {
    const tick = Math.round(n.tick + (Math.round(n.tick / g) * g - n.tick) * strength);
    const duration = ends ? Math.max(g, Math.round(n.duration / g) * g) : n.duration;
    return { ...n, tick: Math.max(0, tick), duration: Math.round(duration) };
  });
}

// ---------------------------------------------------------------- changes (pure: a new project each time)
const copy = (x) => JSON.parse(JSON.stringify(x));
export function update(p, f) { const q = copy(p); f(q); return q; }
const clip = (q, id) => q.clips.find((c) => c.id === id);

export function addTrack(p, { name, kind = 'midi', program = 0 } = {}) {
  const used = new Set(p.tracks.map((t) => t.channel));
  let channel = 0;
  while ((used.has(channel) || channel === 9) && channel < 15) channel++;
  const id = newId('t');
  return { p: update(p, (q) => q.tracks.push({ id, name: name ?? KINDS[kind], kind, program, channel, mute: false })), id };
}
export const setTrack = (p, id, fields) => update(p, (q) => Object.assign(q.tracks.find((t) => t.id === id) ?? {}, fields));
export const removeTrack = (p, id) => update(p, (q) => { q.tracks = q.tracks.filter((t) => t.id !== id); q.clips = q.clips.filter((c) => c.track !== id); });

export function addClip(p, fields) {
  const id = fields.id ?? newId('c');
  return { p: update(p, (q) => q.clips.push({ id, track: q.tracks[0]?.id, start: 0, name: 'Clip', notes: [], tag: '', interpret: '', ...copy(fields), id })), id };
}
export const removeClips = (p, ids) => update(p, (q) => { q.clips = q.clips.filter((c) => !ids.includes(c.id)); });
export const setClip = (p, id, fields) => update(p, (q) => Object.assign(clip(q, id) ?? {}, copy(fields)));
export const moveClip = (p, id, start, track) => update(p, (q) => { const c = clip(q, id); if (c) { c.start = Math.max(0, Math.round(start)); if (track) c.track = track; } });
// Arrow keys: one grid step (or one tick with no snap); with Shift, a bar.
export const nudge = (p, ids, dir, big = false) => update(p, (q) => {
  const step = big ? ticksPerBar(q) : gridTicks(q);
  for (const c of q.clips) if (ids.includes(c.id)) c.start = Math.max(0, c.start + dir * step);
});
export function duplicateClip(p, id) {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return { p, id: null };
  return addClip(p, { ...copy(c), id: undefined, name: `${c.name} (copy)`, start: c.start + clipLength(p, c) });
}
export const quantiseClip = (p, id, grid = p.grid, opts = {}) => update(p, (q) => { const c = clip(q, id); if (c) c.notes = quantise(c.notes, gridTicks(q, grid), opts); });
export const transposeClip = (p, id, semis) => update(p, (q) => { const c = clip(q, id); if (c) for (const n of c.notes) n.pitch = Math.max(0, Math.min(127, n.pitch + semis)); });

// Every note in place, with its track's channel and instrument (muted tracks left out).
export function arranged(p, { includeMuted = false } = {}) {
  const tracks = new Map(p.tracks.map((t) => [t.id, t]));
  const out = [];
  for (const c of p.clips) {
    const t = tracks.get(c.track);
    if (!t || (t.mute && !includeMuted)) continue;
    for (const n of c.notes) out.push({ ...n, tick: c.start + n.tick, track: t.id, channel: n.channel ?? t.channel, program: n.program ?? t.program, kind: t.kind, clip: c.id });
  }
  return out.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}
