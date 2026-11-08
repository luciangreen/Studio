// Music-Composer songs in Studio. Music-Composer writes each song as song<date>.mid (through
// asc2mid: 384 ticks a beat, tempo 63, 4/4) with song<date>_meta.txt beside it, a Prolog term
// holding the form ([n,v1,i1,v2,c,t2,s,c,o]), lyrics, melody, harmony and instruments. Every
// section of the form is four bars, one after another from bar 1. Studio cuts the song into
// those sections as clips, named from the form, so they can be auditioned and tagged.
import { parseProgram } from './core.js';
import { readSMF, songOf } from './smf.js';
import { newProject } from './project.js';

export const SECTION_NAMES = { n: 'Intro', v: 'Verse', c: 'Chorus', i: 'Instrumental', t: 'Instrumental', s: 'Solo', o: 'Outro' };
export function sectionName(code) {
  const m = /^([a-z])(\d*)$/.exec(String(code));
  if (!m) return String(code);
  return `${SECTION_NAMES[m[1]] ?? m[1]}${m[2] ? ` ${m[2]}` : ''}`;
}

// The meta file as plain values: lists become arrays, atoms and strings become strings.
export function parseMeta(text) {
  const t = String(text ?? '').trim().replace(/\.\s*$/, '');
  if (!t) return null;
  let clauses;
  try { clauses = parseProgram(`meta(${t}).`); } catch { return null; }
  const plain = (x) => {
    if (typeof x === 'number') return x;
    if (x.f === '[]' && !x.args?.length) return [];
    if (x.f === '[|]') { const out = []; while (x.f === '[|]') { out.push(plain(x.args[0])); x = x.args[1]; } return out; }
    return x.args?.length ? { [x.f]: x.args.map(plain) } : x.f;
  };
  const list = plain(clauses[0].head.args[0]);
  if (!Array.isArray(list)) return null;
  const meta = {};
  for (const pair of list) if (Array.isArray(pair) && typeof pair[0] === 'string') meta[pair[0]] = pair[1];
  return meta;
}

// Lyrics for a section code (v1, c, s...), as lines of words.
export function lyricsFor(meta, code) {
  const entry = (meta?.lyrics ?? []).find((l) => Array.isArray(l) && l[0] === code);
  return entry ? entry.slice(1).map((line) => (Array.isArray(line) ? line.join(' ') : String(line))) : [];
}

// A Music-Composer song as a Studio project: one track per MIDI track (with its instrument),
// and one clip per section per track that plays in it, tagged by nothing yet.
export function importComposer(bytes, metaText = '', { file = 'song.mid' } = {}) {
  const song = songOf(readSMF(bytes));
  const meta = parseMeta(metaText);
  const p = newProject({ bpm: Math.round(song.bpm * 100) / 100, num: song.num, den: song.den, division: song.division });
  const bar = song.division * (4 / song.den) * song.num;
  const length = song.notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0);
  const nSections = Math.max(1, Math.ceil(length / (bar * 4)));
  const form = Array.isArray(meta?.form) && meta.form.length ? meta.form.map(String) : Array.from({ length: nSections }, (_, i) => `section ${i + 1}`);
  const trackIds = [...new Set(song.notes.map((n) => n.track))].sort((a, b) => a - b);
  p.tracks = trackIds.map((ti, i) => {
    const first = song.notes.find((n) => n.track === ti);
    const name = song.names[ti]?.trim();
    return { id: `t${ti}`, name: (name && !/^".*"$/.test(name) && name.length < 40 ? name : `Track ${i + 1}`), kind: 'midi', program: first.program, channel: first.channel, mute: false };
  });
  p.clips = [];
  form.forEach((code, si) => {
    const from = si * bar * 4, to = from + bar * 4;
    const label = /^section \d+$/.test(code) ? `Section ${si + 1}` : sectionName(code);
    for (const ti of trackIds) {
      const notes = song.notes.filter((n) => n.track === ti && n.tick >= from && n.tick < to)
        .map((n) => ({ tick: n.tick - from, duration: Math.min(n.duration, to - n.tick), pitch: n.pitch, velocity: n.velocity }));
      if (!notes.length) continue;
      const lyrics = lyricsFor(meta, code);
      p.clips.push({ id: `s${si}t${ti}`, track: `t${ti}`, start: from, length: bar * 4, name: label, notes, tag: '', interpret: '',
        source: { kind: 'composer', file, section: code, index: si }, ...(lyrics.length && ti === trackIds[0] ? { lyricsText: lyrics.join('\n') } : {}) });
    }
  });
  return { project: p, meta, form, sections: form.map((code, i) => ({ index: i, code, name: /^section \d+$/.test(code) ? `Section ${i + 1}` : sectionName(code), bar: i * 4 + 1 })) };
}
