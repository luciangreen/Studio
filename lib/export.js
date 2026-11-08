// Exporting: a MIDI file of the arrangement (one track per Studio track, with section markers
// and lyrics), the notes on how to interpret it as text beside it, and a bundle for AI music
// tools (the MIDI, one MIDI file per track, the lyrics, the notes and a prompt).
import { readSMF, songOf, writeSMF, noteName } from './smf.js';
import { TAGS, arranged, barBeat, clipLength, projectLength, seconds, ticksPerBar } from './project.js';
import { GM } from './gm-names.js';

const tracksInOrder = (p) => p.tracks.filter((t) => !t.mute);

export function toSMF(p, { only = null } = {}) {
  const notes = arranged(p);
  const parts = tracksInOrder(p).filter((t) => !only || t.id === only).map((t) => {
    const mine = notes.filter((n) => n.track === t.id);
    return {
      name: t.name, channel: t.channel, program: t.program,
      notes: mine.map((n) => ({ tick: n.tick, duration: n.duration, pitch: n.pitch, velocity: n.velocity })),
      lyrics: mine.filter((n) => n.lyric).map((n) => ({ tick: n.tick, text: n.lyric }))
    };
  });
  const clips = [...p.clips].sort((a, b) => a.start - b.start);
  const markers = [];
  for (const c of clips) {
    const text = `${c.name}${c.tag ? ` [${TAGS[c.tag]}]` : ''}`;
    if (!markers.some((m) => m.tick === c.start && m.text === text)) markers.push({ tick: c.start, text });
  }
  const texts = clips.filter((c) => c.interpret?.trim()).map((c) => ({ tick: c.start, text: `${c.name}: ${c.interpret.trim()}` }));
  return writeSMF({ division: p.division, bpm: p.bpm, num: p.num, den: p.den, markers, texts, parts });
}

// The notes beside the MIDI: what each clip is, where, on what, how to interpret it, and what
// to do with it (its tag).
export function notesText(p, { title = 'Untitled' } = {}) {
  const lines = [`# ${title}`, '', `${p.bpm} BPM, ${p.num}/${p.den}, ${Math.ceil(projectLength(p) / ticksPerBar(p))} bars (${Math.round(seconds(p, projectLength(p)))} seconds).`, ''];
  const tracks = new Map(p.tracks.map((t) => [t.id, t]));
  lines.push('## Tracks', '');
  for (const t of p.tracks) lines.push(`- ${t.name}: ${GM[t.program] ?? 'program ' + t.program}${t.kind !== 'midi' ? ` (${t.kind})` : ''}${t.mute ? ', muted' : ''}`);
  lines.push('', '## Clips', '');
  for (const c of [...p.clips].sort((a, b) => a.start - b.start || String(a.track).localeCompare(String(b.track)))) {
    const t = tracks.get(c.track);
    const end = c.start + clipLength(p, c);
    const range = c.notes.length ? `${noteName(Math.min(...c.notes.map((n) => n.pitch)))}–${noteName(Math.max(...c.notes.map((n) => n.pitch)))}` : 'no notes';
    lines.push(`### ${c.name} (bar ${barBeat(p, c.start)} to ${barBeat(p, end)}, ${t?.name ?? 'no track'})`);
    lines.push(`${c.notes.length} notes, ${range}.${c.tag ? ` Tag: ${TAGS[c.tag]}.` : ''}`);
    if (c.interpret?.trim()) lines.push(`How to interpret it: ${c.interpret.trim()}`);
    const lyric = c.notes.filter((n) => n.lyric).map((n) => n.lyric).join(' ').replace(/- /g, '');
    if (lyric) lines.push(`Lyrics: ${lyric}`);
    if (c.lyricsText) lines.push(`Lyrics (from Music-Composer): ${c.lyricsText.replace(/\n/g, ' / ')}`);
    if (c.source?.kind === 'composer') lines.push(`From Music-Composer: ${c.source.file}, section ${c.source.section}.`);
    lines.push('');
  }
  return lines.join('\n');
}

// A prompt describing the piece for an AI music tool, built from the project (no AI used).
export function prompt(p, { title = 'Untitled', style = '' } = {}) {
  const tags = [...new Set(p.clips.map((c) => c.tag).filter(Boolean))].map((t) => TAGS[t].toLowerCase());
  const instruments = [...new Set(tracksInOrder(p).map((t) => GM[t.program] ?? `program ${t.program}`))];
  const sections = [...p.clips].sort((a, b) => a.start - b.start).map((c) => c.name).filter((n, i, a) => a.indexOf(n) === i);
  const notes = p.clips.filter((c) => c.interpret?.trim()).map((c) => `${c.name}: ${c.interpret.trim()}`);
  return [
    `"${title}"${style ? `, ${style}` : ''}, ${p.bpm} BPM in ${p.num}/${p.den}.`,
    instruments.length ? `Instruments: ${instruments.join(', ')}.` : '',
    sections.length ? `Sections in order: ${sections.join(', ')}.` : '',
    tags.length ? `Uses: ${tags.join(', ')}.` : '',
    notes.length ? `Notes: ${notes.join(' ')}` : '',
    'Follow the attached MIDI for melody, harmony and timing.'
  ].filter(Boolean).join('\n');
}

// Everything to hand to an AI music tool, as files.
export function aiBundle(p, { title = 'Untitled', style = '', base = 'song' } = {}) {
  const lyrics = p.clips.flatMap((c) => [c.notes.filter((n) => n.lyric).map((n) => n.lyric).join(' ').replace(/- /g, ''), c.lyricsText ?? '']).filter(Boolean).join('\n\n');
  const files = [
    { name: `${base}.mid`, bytes: toSMF(p) },
    { name: `${base}.notes.md`, text: notesText(p, { title }) },
    { name: `${base}.prompt.txt`, text: prompt(p, { title, style }) },
    { name: `${base}.studio.json`, text: JSON.stringify(p, null, 1) }
  ];
  if (lyrics) files.push({ name: `${base}.lyrics.txt`, text: `${lyrics}\n` });
  for (const t of tracksInOrder(p)) if (p.clips.some((c) => c.track === t.id && c.notes.length)) files.push({ name: `${base}.${t.name.replace(/[^\w-]+/g, '_')}.mid`, bytes: toSMF(p, { only: t.id }) });
  return files;
}

// A MIDI file read back as a Studio project: one track per part, one clip per section marker
// (or one clip per track), with tags, interpretation notes and lyrics restored.
export function fromSMF(bytes) {
  const smf = readSMF(bytes);
  const song = songOf(smf);
  const tagOf = Object.fromEntries(Object.entries(TAGS).filter(([k]) => k).map(([k, v]) => [v, k]));
  const parts = smf.tracks.map((t, i) => ({ i, name: t.name })).filter((t) => song.notes.some((n) => n.track === t.i));
  const tracks = parts.map((t) => { const n = song.notes.find((x) => x.track === t.i); return { id: `t${t.i}`, name: t.name || `Track ${t.i}`, kind: 'midi', program: n.program, channel: n.channel, mute: false }; });
  const markers = song.markers.map((m) => { const mm = /^(.*?)(?: \[(.+)\])?$/.exec(m.text); return { tick: m.tick, name: mm[1], tag: tagOf[mm[2]] ?? '' }; }).sort((a, b) => a.tick - b.tick);
  const bounds = markers.length ? markers.map((m) => m.tick).filter((t, i, a) => a.indexOf(t) === i) : [0];
  const end = song.notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0) + 1;
  const clips = [];
  bounds.forEach((from, bi) => {
    const to = bounds[bi + 1] ?? end;
    const mk = markers.find((m) => m.tick === from) ?? { name: 'Clip', tag: '' };
    const interp = song.texts.find((t) => t.tick === from && t.text.startsWith(`${mk.name}: `))?.text.slice(mk.name.length + 2) ?? '';
    for (const t of tracks) {
      const ti = Number(t.id.slice(1));
      const ns = song.notes.filter((n) => n.track === ti && n.tick >= from && n.tick < to);
      if (!ns.length) continue;
      const lyr = song.lyrics.filter((l) => l.track === ti);
      clips.push({ id: `c${bi}${t.id}`, track: t.id, start: from, name: mk.name, tag: mk.tag, interpret: interp,
        notes: ns.map((n) => ({ tick: n.tick - from, duration: n.duration, pitch: n.pitch, velocity: n.velocity, ...(lyr.find((l) => l.tick === n.tick) ? { lyric: lyr.find((l) => l.tick === n.tick).text } : {}) })) });
    }
  });
  return { division: song.division, bpm: song.bpm, num: song.num, den: song.den, grid: 'beat', zoom: 100, tracks, clips };
}
