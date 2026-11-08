// Studio as a Lucian Office document (data.project), so each change, yours or the character's,
// is one undoable step; and the character's commands.
import { createCommands, createDocument } from './core.js';
import { GRIDS, TAGS, addClip, addTrack, clipLength, moveClip, quantiseClip, setClip, setTrack, ticksPerBar, transposeClip, update } from './project.js';
import { guitarNotes, singNotes } from './parts.js';

export const newStudioDoc = (project, title = 'Untitled song') => createDocument({ app: 'studio', title, data: { project } });
export const projectOf = (doc) => doc.data.project;
export const projectOps = (p) => [{ op: 'data', key: 'project', value: p }];

const clean = (s) => String(s ?? '').trim().replace(/^["“']|["”']$/g, '').replace(/[.!]$/, '').trim();

// A clip as people name it: "it" (the selected one), "the chorus", "chorus 2" (the second),
// "the intro on the piano".
export function findClips(p, phrase, selected = []) {
  const s = clean(phrase).toLowerCase().replace(/^the\s+/, '');
  if (/^(it|this|that|this clip|that clip|the clip)$/.test(s)) return p.clips.filter((c) => selected.includes(c.id));
  if (/^(everything|all|all clips|the song|the whole song)$/.test(s)) return p.clips;
  const [, what, track] = /^(.*?)(?:\s+on\s+(?:the\s+)?(.+))?$/.exec(s);
  const m = /^(.*?)\s+(\d+)$/.exec(what);
  const byName = (name) => p.clips.filter((c) => c.name.toLowerCase() === name || c.name.toLowerCase().replace(/\s+\d+$/, '') === name);
  let found = byName(what);
  if (!found.length && m) {
    // "chorus 2": the second start of a clip named chorus
    const starts = [...new Set(byName(m[1]).map((c) => c.start))].sort((a, b) => a - b);
    const at = starts[Number(m[2]) - 1];
    found = at === undefined ? [] : byName(m[1]).filter((c) => c.start === at);
  } else if (found.length) {
    const firstStart = Math.min(...found.map((c) => c.start));
    if (!/\d$/.test(what)) found = found.filter((c) => c.start === firstStart);
  }
  if (track) found = found.filter((c) => p.tracks.find((t) => t.id === c.track)?.name.toLowerCase().includes(track));
  return found;
}

const GRID_WORDS = [[/^(off|no snap|nothing|free)$/, 'off'], [/^bars?$/, 'bar'], [/^(beats?|quarter notes?|crotchets?)$/, 'beat'], [/^(half beats?|eighth notes?|eighths|quavers?)$/, '1/2'], [/^(triplets?)$/, '1/3'], [/^(quarter beats?|sixteenth notes?|sixteenths|semiquavers?)$/, '1/4'], [/^(eighths? of a beat|thirty-?second notes?)$/, '1/8']];
export const gridFromWords = (s) => GRID_WORDS.find(([re]) => re.test(clean(s).toLowerCase().replace(/^(the|a)\s+/, '')))?.[1] ?? (GRIDS[clean(s)] ? clean(s) : null);
const TAG_WORDS = { background: /background/, sound: /sound effect|sfx|sound/, vocal: /vocal|voice/, expand: /expand|music-?composer/, '': /none|nothing|no tag|untag/ };
const tagFromWords = (s) => Object.entries(TAG_WORDS).find(([, re]) => re.test(clean(s).toLowerCase()))?.[0];

function transpose({ args, doc, ctx }, sign) {
  const p = projectOf(doc); const cs = findClips(p, args.clip, ctx.selected?.() ?? []);
  const n = Number(String(args.n).replace(/semitones?/, ''));
  if (!cs.length) return { ops: [], say: `I can't find ${clean(args.clip)} in the song.` };
  if (!(n > 0 && n <= 48)) return { ops: [], say: 'How many semitones?' };
  let q = p; for (const c of cs) q = transposeClip(q, c.id, sign * n);
  return { ops: projectOps(q), say: `Transposed ${cs[0].name} ${sign > 0 ? 'up' : 'down'} ${n}.` };
}

function muteTrack(doc, phrase, on) {
  const p = projectOf(doc); const name = clean(phrase).toLowerCase().replace(/^the\s+/, '');
  const t = p.tracks.find((x) => x.name.toLowerCase() === name) ?? p.tracks.find((x) => x.name.toLowerCase().includes(name));
  if (!t) return { ops: [], say: `There's no track called ${clean(phrase)}.` };
  return { ops: projectOps(setTrack(p, t.id, { mute: on })), say: `${t.name} is ${on ? 'muted' : 'on'}.` };
}

export function studioCommands() {
  const reg = createCommands({ app: 'Studio' });
  const none = (phrase) => ({ ops: [], say: `I can't find ${clean(phrase)} in the song.` });
  reg
    .register({ name: 'tempo', patterns: ['set the tempo to {n}', 'tempo {n}', 'make it {n} bpm', 'set the bpm to {n}'], help: 'set the tempo to 90',
      run: ({ args, doc }) => { const n = Number(String(args.n).replace(/bpm/i, '')); if (!(n >= 20 && n <= 300)) return { ops: [], say: 'A tempo between 20 and 300 BPM, please.' }; return { ops: projectOps(update(projectOf(doc), (q) => { q.bpm = n; })), say: `The tempo is ${n} BPM.` }; } })
    .register({ name: 'snap', patterns: ['snap to {grid}', 'set the grid to {grid}', 'turn snap off'], help: 'snap to eighth notes',
      run: ({ args, doc }) => { const g = args.grid === undefined ? 'off' : gridFromWords(args.grid); if (!g) return { ops: [], say: `Snap to bars, beats, half beats, triplets, quarter beats or off.` }; return { ops: projectOps(update(projectOf(doc), (q) => { q.grid = g; })), say: g === 'off' ? 'Snap is off.' : `Snapping to ${GRIDS[g].toLowerCase()}s.` }; } })
    .register({ name: 'zoom', patterns: ['zoom to {n}', 'zoom {n}'], help: 'zoom to 150%',
      run: ({ args, doc }) => { const n = Number(String(args.n).replace('%', '')); if (!(n >= 10 && n <= 800)) return { ops: [], say: 'Zoom between 10% and 800%.' }; return { ops: projectOps(update(projectOf(doc), (q) => { q.zoom = n; })), say: `Zoomed to ${n}%.` }; } })
    .register({ name: 'quantise', patterns: ['quantise {clip} to {grid}', 'quantize {clip} to {grid}', 'quantise {clip}', 'quantize {clip}'], help: 'quantise the chorus to eighth notes',
      run: ({ args, doc, ctx }) => {
        const p = projectOf(doc); const cs = findClips(p, args.clip, ctx.selected?.() ?? []);
        if (!cs.length) return none(args.clip);
        const g = args.grid ? gridFromWords(args.grid) : (p.grid === 'off' ? 'beat' : p.grid);
        if (!g || g === 'off') return { ops: [], say: 'Quantise to bars, beats, half beats, triplets or quarter beats.' };
        let q = p; for (const c of cs) q = quantiseClip(q, c.id, g);
        return { ops: projectOps(q), say: `Quantised ${cs.length === 1 ? cs[0].name : `${cs.length} clips`} to ${GRIDS[g].toLowerCase()}s.` };
      } })
    .register({ name: 'tag', patterns: ['tag {clip} as {tag}', 'mark {clip} as {tag}', 'use {clip} as {tag}'], help: 'tag the chorus as background music',
      run: ({ args, doc, ctx }) => {
        const p = projectOf(doc); const cs = findClips(p, args.clip, ctx.selected?.() ?? []);
        if (!cs.length) return none(args.clip);
        const tag = tagFromWords(args.tag);
        if (tag === undefined) return { ops: [], say: `Tag it as ${Object.values(TAGS).slice(1).join(', ').toLowerCase()}.` };
        let q = p; for (const c of cs) q = setClip(q, c.id, { tag });
        return { ops: projectOps(q), say: `${cs[0].name}: ${TAGS[tag].toLowerCase()}.` };
      } })
    .register({ name: 'interpret', patterns: ['note on {rest}', 'interpret {rest}', 'add a note to {rest}'], help: 'note on the intro: quiet, then build',
      run: ({ args, doc, ctx }) => {
        const m = /^(.+?)\s*:\s*(.+)$/.exec(args.rest);
        if (!m) return { ops: [], say: 'Say it like "note on the intro: quiet, then build".' };
        const p = projectOf(doc); const cs = findClips(p, m[1], ctx.selected?.() ?? []);
        if (!cs.length) return none(m[1]);
        let q = p; for (const c of cs) q = setClip(q, c.id, { interpret: clean(m[2]) });
        return { ops: projectOps(q), say: `Noted on ${cs[0].name}: ${clean(m[2])}.` };
      } })
    .register({ name: 'move', patterns: ['move {clip} to bar {n}'], help: 'move the solo to bar 9',
      run: ({ args, doc, ctx }) => {
        const p = projectOf(doc); const cs = findClips(p, args.clip, ctx.selected?.() ?? []); const n = Number(args.n);
        if (!cs.length) return none(args.clip);
        if (!(n >= 1)) return { ops: [], say: 'Which bar, from 1?' };
        const from = Math.min(...cs.map((c) => c.start)); const to = (n - 1) * ticksPerBar(p);
        let q = p; for (const c of cs) q = moveClip(q, c.id, c.start - from + to);
        return { ops: projectOps(q), say: `Moved ${cs[0].name} to bar ${n}.` };
      } })
    .register({ name: 'transpose up', patterns: ['transpose {clip} up {n} semitones', 'transpose {clip} up {n}', 'move {clip} up {n} semitones'], help: 'transpose the chorus up 2', run: (x) => transpose(x, 1) })
    .register({ name: 'transpose down', patterns: ['transpose {clip} down {n} semitones', 'transpose {clip} down {n}', 'move {clip} down {n} semitones'], help: 'transpose the chorus down 3', run: (x) => transpose(x, -1) })
    .register({ name: 'mute', patterns: ['mute {track}'], help: 'mute the piano', run: ({ args, doc }) => muteTrack(doc, args.track, true) })
    .register({ name: 'unmute', patterns: ['unmute {track}'], help: 'unmute the piano', run: ({ args, doc }) => muteTrack(doc, args.track, false) })
    .register({ name: 'guitar', patterns: ['add a guitar part {chords} with {pattern}', 'add a guitar part {chords}', 'add guitar {chords}'], help: 'add a guitar part C G Am F',
      run: ({ args, doc }) => {
        let p = projectOf(doc);
        let notes;
        const pattern = args.pattern ? clean(args.pattern).replace(/^(the\s+)?(pattern|strum)\s+/i, '').toUpperCase() : 'D DU UDU';
        try { notes = guitarNotes(clean(args.chords), { pattern, ticksPerBeat: p.division * (4 / p.den), beatsPerBar: p.num }); } catch (err) { return { ops: [], say: `${err.message}.` }; }
        let track = p.tracks.find((t) => t.kind === 'guitar');
        if (!track) { const r = addTrack(p, { name: 'Guitar', kind: 'guitar', program: 25 }); p = r.p; track = p.tracks.find((t) => t.id === r.id); }
        const start = p.clips.filter((c) => c.track === track.id).reduce((m, c) => Math.max(m, c.start + clipLength(p, c)), 0);
        const r = addClip(p, { track: track.id, start, name: `Guitar ${clean(args.chords)}`, notes, length: clean(args.chords).split(/[\s,|]+/).filter(Boolean).length * ticksPerBar(p) });
        return { ops: projectOps(r.p), say: `Added a guitar part (${clean(args.chords)}, strummed ${pattern}).` };
      } })
    .register({ name: 'sing', patterns: ['sing {lyric} on {clip}', 'put the words {lyric} on {clip}'], help: 'sing "calm in ten minutes" on the verse',
      run: ({ args, doc, ctx }) => {
        let p = projectOf(doc); const cs = findClips(p, args.clip, ctx.selected?.() ?? []);
        if (!cs.length) return none(args.clip);
        const melody = cs[0];
        let track = p.tracks.find((t) => t.kind === 'vocal');
        if (!track) { const r = addTrack(p, { name: 'Vocal', kind: 'vocal', program: 52 }); p = r.p; track = p.tracks.find((t) => t.id === r.id); }
        // the melody: the top note at each moment
        const top = [...melody.notes].sort((a, b) => a.tick - b.tick || b.pitch - a.pitch).filter((n, i, a) => i === 0 || n.tick !== a[i - 1].tick);
        const notes = singNotes(top, clean(args.lyric));
        const r = addClip(p, { track: track.id, start: melody.start, name: `${melody.name} (sung)`, notes, length: clipLength(p, melody), tag: 'vocal' });
        return { ops: projectOps(r.p), say: `Sung on ${melody.name}: ${notes.filter((n) => n.lyric).length} syllables on ${notes.length} notes.` };
      } });
  return reg;
}
