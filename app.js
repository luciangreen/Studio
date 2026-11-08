// Studio: Sound Sequencer MR (Lucian Office, Phase 8). Arrange MIDI samples on tracks with
// notes on how to interpret them, quantise, hum notes in, add guitar and sung parts, audition
// and tag Music-Composer sections, and export the MIDI with its notes, or a bundle for AI tools.
import { api } from '/shared/api.js';
import { apply, characterHandler, deserialise, redo, serialise, toProlog, undo } from './lib/core.js';
import { GRIDS, KINDS, TAGS, addClip, addTrack, align, arranged, barBeat, clipLength, duplicateClip, gridTicks, moveClip, newProject, nudge, projectLength, pxPerTick, quantiseClip, removeClips, removeTrack, seconds, setClip, setTrack, snap, ticksAt, ticksPerBar, ticksPerBeat, transposeClip, update } from './lib/project.js';
import { importComposer, sectionName } from './lib/composer.js';
import { humToNotes } from './lib/hum.js';
import { guitarNotes, singNotes } from './lib/parts.js';
import { aiBundle, fromSMF, notesText, toSMF } from './lib/export.js';
import { GM } from './lib/gm-names.js';
import { noteName } from './lib/smf.js';
import { newStudioDoc, projectOf, projectOps, studioCommands } from './lib/commands.js';
import { playNotes, recordMic } from './lib/voices.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const { dataset, style, ...rest } = props;
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(rest)) if (k.startsWith('aria-')) n.setAttribute(k, v); else n[k] = v;
  Object.assign(n.dataset, dataset ?? {});
  if (style) n.style.cssText = style;
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const say = (t) => { $('reply').textContent = t; };
const LANE = 64;

let doc = newStudioDoc(newProject());
let selected = [];
let playhead = 0; // ticks
let player = null;
let recording = null;
let side = 'clip';
let sections = []; // Music-Composer sections of the loaded song
let settings = { savePath: '', autoQuantise: true };
const SIDES = [['clip', 'Clip'], ['sections', 'Sections'], ['parts', 'Add a part'], ['notes', 'Notes']];

const P = () => projectOf(doc);
const persist = () => { api.state.set('studio', settings).catch(() => {}); api.state.set('studio-doc', doc).catch(() => {}); };
function change(p, label) {
  doc = apply(doc, projectOps(p), { by: 'user', label });
  selected = selected.filter((id) => P().clips.some((c) => c.id === id));
  persist();
  render();
}

// ------------------------------------------------------------------ the arrangement
function render() {
  const p = P();
  $('title').value = doc.title;
  $('bpm').value = p.bpm;
  $('sig').value = `${p.num}/${p.den}`;
  $('grid').value = p.grid;
  $('zoom').value = p.zoom; $('zoomText').textContent = `${p.zoom}%`;
  const ppt = pxPerTick(p);
  const total = Math.max(projectLength(p) + ticksPerBar(p) * 4, ticksPerBar(p) * 16);
  const width = Math.ceil(total * ppt);
  // track headers
  $('heads').replaceChildren(...p.tracks.map((t) => el('div', { className: 'head' },
    el('input', { type: 'text', value: t.name, 'aria-label': 'Track name', onchange: (e) => change(setTrack(P(), t.id, { name: e.target.value.trim() || t.name }), 'renamed a track') }),
    el('select', { 'aria-label': 'Instrument', onchange: (e) => change(setTrack(P(), t.id, { program: Number(e.target.value) }), 'changed an instrument') }, GM.map((g, i) => el('option', { value: i, textContent: `${i + 1} ${g}`, selected: i === t.program }))),
    el('div', { className: 'hrow' }, el('span', { className: 'note', textContent: KINDS[t.kind] }),
      el('button', { type: 'button', textContent: 'M', title: 'Mute', className: t.mute ? 'on' : '', onclick: () => change(setTrack(P(), t.id, { mute: !t.mute }), t.mute ? 'unmuted a track' : 'muted a track') }),
      el('button', { type: 'button', textContent: '✕', title: 'Delete track', onclick: () => { if (confirm(`Delete ${t.name} and its clips?`)) change(removeTrack(P(), t.id), 'deleted a track'); } })))));
  // ruler: bar numbers
  const bar = ticksPerBar(p);
  const ruler = $('ruler'); ruler.style.width = `${width}px`;
  ruler.replaceChildren(...Array.from({ length: Math.ceil(total / bar) }, (_, i) => el('div', { className: 'bar', textContent: String(i + 1), style: `left:${i * bar * ppt}px` })));
  // lanes and clips
  const beat = ticksPerBeat(p);
  const lanes = p.tracks.map((t) => {
    const lane = el('div', { className: 'lane', dataset: { track: t.id }, style: `width:${width}px` });
    if (ppt * beat >= 8) for (let k = 0; k * beat < total; k++) lane.append(el('div', { className: `gl${k % p.num === 0 ? ' barl' : ''}`, style: `left:${k * beat * ppt}px` }));
    else for (let k = 0; k * bar < total; k++) lane.append(el('div', { className: 'gl barl', style: `left:${k * bar * ppt}px` }));
    for (const c of p.clips.filter((x) => x.track === t.id)) lane.append(clipEl(p, c, ppt));
    return lane;
  });
  $('tracks').replaceChildren(...lanes);
  $('tracks').style.width = `${width}px`;
  placePlayhead();
  renderSide();
}

function clipEl(p, c, ppt) {
  const len = clipLength(p, c);
  const node = el('div', { className: `clip${selected.includes(c.id) ? ' sel' : ''}${c.tag ? ` tag-${c.tag}` : ''}`, dataset: { id: c.id }, title: `${c.name}${c.tag ? ` · ${TAGS[c.tag]}` : ''}${c.interpret ? ` · ${c.interpret}` : ''}`, style: `left:${c.start * ppt}px;width:${Math.max(6, len * ppt)}px` });
  node.append(el('div', { className: 'cn', textContent: `${c.name}${c.interpret ? ' ✎' : ''}` }));
  if (c.notes.length) {
    const lo = Math.min(...c.notes.map((n) => n.pitch)), hi = Math.max(...c.notes.map((n) => n.pitch));
    const span = Math.max(1, hi - lo);
    const rects = c.notes.map((n) => `<rect x="${(n.tick / len) * 100}%" y="${((hi - n.pitch) / span) * 32 + 1}" width="${Math.max(0.4, (n.duration / len) * 100)}%" height="4" rx="1"/>`).join('');
    node.insertAdjacentHTML('beforeend', `<svg fill="#1a3e75aa">${rects}</svg>`);
  }
  node.addEventListener('pointerdown', (e) => startDrag(e, c));
  node.addEventListener('dblclick', () => { side = 'clip'; renderSide(); });
  return node;
}

// Dragging: horizontally snaps to the grid, or with Shift lines up with clip edges and bar
// lines; vertically moves to another track.
let drag = null;
function startDrag(e, c) {
  e.preventDefault(); e.stopPropagation();
  if (e.shiftKey && !selected.includes(c.id)) selected = [...selected, c.id];
  else if (!selected.includes(c.id)) selected = [c.id];
  const p = P();
  drag = { id: c.id, x0: e.clientX, y0: e.clientY, start0: c.start, track0: c.track, moved: false, node: e.currentTarget, len: clipLength(p, c) };
  e.currentTarget.setPointerCapture?.(e.pointerId);
  for (const n of document.querySelectorAll('.clip')) n.classList.toggle('sel', selected.includes(n.dataset.id));
  renderSide();
}
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = P(); const ppt = pxPerTick(p);
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
  drag.moved = true;
  const raw = Math.max(0, drag.start0 + dx / ppt);
  drag.start = e.shiftKey ? align(p, raw, { clipId: drag.id, length: drag.len }) : snap(p, raw);
  const ti = Math.max(0, Math.min(p.tracks.length - 1, p.tracks.findIndex((t) => t.id === drag.track0) + Math.round(dy / LANE)));
  drag.track = p.tracks[ti].id;
  drag.node.style.left = `${drag.start * ppt}px`;
  drag.node.style.transform = `translateY(${(ti - p.tracks.findIndex((t) => t.id === drag.track0)) * LANE}px)`;
  $('pos').textContent = barBeat(p, drag.start);
});
addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved && (d.start !== d.start0 || d.track !== d.track0)) change(moveClip(P(), d.id, d.start, d.track), 'moved a clip');
  else render();
});

function placePlayhead() {
  const p = P();
  $('playhead').style.left = `${playhead * pxPerTick(p)}px`;
  $('pos').textContent = barBeat(p, playhead);
}

// ------------------------------------------------------------------ playing
const asSeconds = (p, notes) => notes.map((n) => ({ ...n, time: seconds(p, n.tick), duration: seconds(p, n.duration) }));
async function play({ only = null, fromTick = playhead } = {}) {
  stop();
  const p = P();
  let notes = arranged(p);
  if (only) notes = notes.filter((n) => only.includes(n.clip));
  if (!notes.length) { say('There is nothing to play yet.'); return; }
  const start = only ? Math.min(...notes.map((n) => n.tick)) : fromTick;
  player = await playNotes(asSeconds(p, notes), { from: seconds(p, start), onTime: (s) => { playhead = Math.max(0, Math.round(ticksAt(P(), s))); placePlayhead(); } });
  $('play').textContent = '❚❚ Pause';
  player.done.then(() => { if (player) { player = null; $('play').textContent = '▶ Play'; } });
}
function stop() { if (player) { player.stop(); player = null; } $('play').textContent = '▶ Play'; }

// ------------------------------------------------------------------ humming
async function toggleRecord() {
  if (recording) {
    const r = recording; recording = null;
    $('rec').classList.remove('on'); $('rec').textContent = '● Hum';
    const { samples, rate } = await r.mic.stop();
    const p = P();
    let notes = humToNotes(samples, rate, { bpm: p.bpm, division: p.division });
    if (!notes.length) { say('I heard no notes. Hum a little louder, one note at a time.'); return; }
    let q = p;
    let track = q.tracks.find((t) => t.kind === 'hum');
    if (!track) { const a = addTrack(q, { name: 'Humming', kind: 'hum', program: 73 }); q = a.p; track = q.tracks.find((t) => t.id === a.id); }
    const res = addClip(q, { track: track.id, start: r.start, name: `Hummed ${barBeat(p, r.start)}`, notes: notes.map(({ cents, ...n }) => n) });
    q = res.p;
    if (settings.autoQuantise && q.grid !== 'off') q = quantiseClip(q, res.id, q.grid, { strength: 1 });
    selected = [res.id];
    change(q, 'hummed a clip');
    say(`Heard ${notes.length} note${notes.length === 1 ? '' : 's'}: ${notes.map((n) => noteName(n.pitch)).join(' ')}${settings.autoQuantise && q.grid !== 'off' ? `, quantised to ${GRIDS[q.grid].toLowerCase()}s` : ''}.`);
    return;
  }
  try {
    const mic = await recordMic();
    recording = { mic, start: snap(P(), playhead, 'bar') };
    $('rec').classList.add('on'); $('rec').textContent = '■ Stop humming';
    say('Listening… hum one note at a time, then press Stop humming.');
  } catch (err) { say(`I couldn't use the microphone: ${err.message}`); }
}

// ------------------------------------------------------------------ the side panel
function renderSide() {
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.side === side);
  $('side').replaceChildren(...({ clip: clipSide, sections: sectionsSide, parts: partsSide, notes: notesSide }[side])().filter((x) => x && x.nodeType));
}
const field = (label, control) => el('label', {}, label, control);
const btn = (text, onclick, props = {}) => el('button', { type: 'button', textContent: text, onclick, ...props });
const tagSelect = (value, onchange) => el('select', { onchange: (e) => onchange(e.target.value) }, Object.entries(TAGS).map(([k, v]) => el('option', { value: k, textContent: v, selected: k === value })));

function clipSide() {
  const p = P();
  const cs = p.clips.filter((c) => selected.includes(c.id));
  if (!cs.length) return [el('p', { className: 'note' }, 'Select a clip to name it, tag it, say how to interpret it, quantise or transpose it. Drag across tracks to move it.')];
  const c = cs[0];
  const t = p.tracks.find((x) => x.id === c.track);
  const set = (fields, label) => { let q = P(); for (const x of cs) q = setClip(q, x.id, fields); change(q, label); };
  const melodyLyric = c.notes.filter((n) => n.lyric).map((n) => n.lyric).join(' ').replace(/- /g, '');
  return [
    el('h3', {}, cs.length > 1 ? `${cs.length} clips` : c.name),
    cs.length === 1 && field('Name', el('input', { type: 'text', value: c.name, onchange: (e) => set({ name: e.target.value.trim() || c.name }, 'renamed a clip') })),
    field('Tag', tagSelect(c.tag, (v) => set({ tag: v }, 'tagged a clip'))),
    field('How to interpret it (written beside the MIDI)', el('textarea', { value: c.interpret ?? '', placeholder: 'e.g. character name y, but cute; quiet, then build', onchange: (e) => set({ interpret: e.target.value }, 'wrote a note') })),
    el('p', { className: 'note' }, `Bar ${barBeat(p, c.start)} to ${barBeat(p, c.start + clipLength(p, c))} on ${t?.name}. ${c.notes.length} notes${c.notes.length ? `, ${noteName(Math.min(...c.notes.map((n) => n.pitch)))}–${noteName(Math.max(...c.notes.map((n) => n.pitch)))}` : ''}.`),
    c.lyricsText && el('p', { className: 'note' }, `Music-Composer lyrics: ${c.lyricsText.replace(/\n/g, ' / ')}`),
    t?.kind === 'vocal' && field('Words (one syllable a note; hyphens split words)', el('input', { type: 'text', value: melodyLyric, onchange: (e) => set({ notes: singNotes(c.notes.map(({ lyric, ...n }) => n), e.target.value) }, 'changed the words') })),
    el('div', { className: 'row' },
      btn('▶ Audition', () => play({ only: cs.map((x) => x.id) })),
      btn('Quantise', () => { let q = P(); for (const x of cs) q = quantiseClip(q, x.id, P().grid === 'off' ? 'beat' : P().grid); change(q, 'quantised'); }),
      btn('Up', () => { let q = P(); for (const x of cs) q = transposeClip(q, x.id, 1); change(q, 'transposed'); }, { title: 'Up a semitone' }),
      btn('Down', () => { let q = P(); for (const x of cs) q = transposeClip(q, x.id, -1); change(q, 'transposed'); }, { title: 'Down a semitone' }),
      cs.length === 1 && btn('Duplicate', () => { const r = duplicateClip(P(), c.id); selected = [r.id]; change(r.p, 'duplicated a clip'); }),
      btn('Delete', () => { change(removeClips(P(), cs.map((x) => x.id)), 'deleted'); selected = []; }))
  ];
}

function sectionsSide() {
  const p = P();
  const groups = new Map();
  for (const c of p.clips) { const key = c.source?.kind === 'composer' ? `${c.source.index}` : null; if (key !== null) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); } }
  if (!groups.size) return [el('p', { className: 'note' }, 'Load a Music-Composer song (above) to audition its sections (intro, verses, chorus, instrumentals, solo, outro) and tag them as background music, a sound or vocal effect, or to expand in Music-Composer.'), btn('Music-Composer song…', importMC)];
  return [
    el('p', { className: 'note' }, 'Each section is four bars. Audition it, then tag what it is for.'),
    ...[...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, cs]) => el('div', { className: 'sect' },
      el('b', {}, `${cs[0].name}`), el('span', { className: 'note' }, `bar ${barBeat(p, cs[0].start)}`),
      btn('▶', () => play({ only: cs.map((x) => x.id) }), { title: 'Audition' }),
      tagSelect(cs[0].tag, (v) => { let q = P(); for (const x of cs) q = setClip(q, x.id, { tag: v }); change(q, 'tagged a section'); }),
      btn('Select', () => { selected = cs.map((x) => x.id); side = 'clip'; render(); })))
  ];
}

function partsSide() {
  const p = P();
  const chords = el('input', { type: 'text', value: 'C G Am F', 'aria-label': 'Chords' });
  const pattern = el('input', { type: 'text', value: 'D DU UDU', 'aria-label': 'Strum pattern' });
  const words = el('input', { type: 'text', placeholder: 'calm in ten mi-nutes a day', 'aria-label': 'Words' });
  const melodyClips = p.clips.filter((c) => p.tracks.find((t) => t.id === c.track)?.kind !== 'vocal' && c.notes.length);
  const melody = el('select', { 'aria-label': 'Melody' }, melodyClips.map((c) => el('option', { value: c.id, textContent: `${c.name} (bar ${barBeat(p, c.start)})`, selected: selected.includes(c.id) })));
  return [
    el('h3', {}, 'Guitar'),
    field('Chords, one a bar', chords),
    field('Strum each bar (D down, U up, space rest; each is half a beat)', pattern),
    el('div', { className: 'row' }, btn('Add at the playhead', () => {
      let q = P(); let notes;
      try { notes = guitarNotes(chords.value, { pattern: pattern.value.toUpperCase(), ticksPerBeat: ticksPerBeat(q), beatsPerBar: q.num }); } catch (err) { say(`${err.message}.`); return; }
      let t = q.tracks.find((x) => x.kind === 'guitar');
      if (!t) { const a = addTrack(q, { name: 'Guitar', kind: 'guitar', program: 25 }); q = a.p; t = q.tracks.find((x) => x.id === a.id); }
      const r = addClip(q, { track: t.id, start: snap(q, playhead, 'bar'), name: `Guitar ${chords.value.trim()}`, notes, length: chords.value.trim().split(/[\s,|]+/).length * ticksPerBar(q) });
      selected = [r.id]; change(r.p, 'added a guitar part');
    })),
    el('h3', {}, 'Sung lyrics'),
    melodyClips.length ? field('On the melody of', melody) : el('p', { className: 'note' }, 'Hum or load a melody first.'),
    field('Words', words),
    el('div', { className: 'row' }, btn('Sing it', () => {
      const src = P().clips.find((c) => c.id === melody.value);
      if (!src || !words.value.trim()) { say('Choose a melody and write the words.'); return; }
      let q = P();
      let t = q.tracks.find((x) => x.kind === 'vocal');
      if (!t) { const a = addTrack(q, { name: 'Vocal', kind: 'vocal', program: 52 }); q = a.p; t = q.tracks.find((x) => x.id === a.id); }
      const top = [...src.notes].sort((a, b) => a.tick - b.tick || b.pitch - a.pitch).filter((n, i, a) => i === 0 || n.tick !== a[i - 1].tick);
      const r = addClip(q, { track: t.id, start: src.start, name: `${src.name} (sung)`, notes: singNotes(top, words.value), length: clipLength(q, src), tag: 'vocal' });
      selected = [r.id]; change(r.p, 'added a sung part');
    }, { disabled: !melodyClips.length })),
    el('h3', {}, 'Humming'),
    el('label', {}, el('input', { type: 'checkbox', checked: settings.autoQuantise, onchange: (e) => { settings.autoQuantise = e.target.checked; persist(); } }), ' Quantise hummed notes to the snap grid'),
    el('p', { className: 'note' }, 'Press ● Hum, hum one note at a time, and press Stop. The notes go on a Humming track at the bar of the playhead.')
  ];
}

function notesSide() {
  const text = notesText(P(), { title: doc.title });
  return [el('p', { className: 'note' }, 'These notes are written beside the MIDI when you export, so whoever (or whatever) plays it knows how to interpret each part.'), el('pre', { style: 'white-space:pre-wrap;font-size:.82em', textContent: text })];
}

// ------------------------------------------------------------------ Music-Composer songs
async function loadComposer(bytes, metaText, file) {
  const r = importComposer(bytes, metaText, { file });
  sections = r.sections;
  doc = newStudioDoc(r.project, file.replace(/\.midi?$/i, ''));
  selected = []; playhead = 0; side = 'sections';
  persist(); render();
  say(`Loaded ${file}: ${r.sections.length} sections${r.meta ? ` (${r.sections.map((s) => s.name).join(', ')})` : ' (no _meta.txt beside it, so they are numbered)'}, ${r.project.tracks.length} tracks, ${r.project.bpm} BPM.`);
}
async function importMC() {
  const path = prompt('A Music-Composer .mid file (in your home folder), or leave empty to choose one from this device', settings.lastMC || 'Dropbox/GitHub-private2/Music-Composer/');
  if (path === null) return;
  if (!path.trim() || path.endsWith('/')) { $('file').click(); return; }
  try {
    const res = await fetch(api.files.rawUrl(path.trim()), { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const metaPath = path.trim().replace(/\.midi?$/i, '_meta.txt');
    const meta = await api.files.read(metaPath).then((r) => r.content, () => '');
    settings.lastMC = path.trim();
    await loadComposer(bytes, meta, path.trim().split('/').pop());
  } catch (err) { say(`Couldn't load ${path}: ${err.message}`); }
}
$('file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const mid = files.find((f) => /\.midi?$/i.test(f.name));
  if (!mid) { say('Choose a .mid file (and its _meta.txt, if you have it).'); return; }
  const metaFile = files.find((f) => f.name === mid.name.replace(/\.midi?$/i, '_meta.txt')) ?? files.find((f) => /_meta\.txt$/.test(f.name));
  const bytes = new Uint8Array(await mid.arrayBuffer());
  try { await loadComposer(bytes, metaFile ? await metaFile.text() : '', mid.name); } catch (err) { say(`Couldn't load ${mid.name}: ${err.message}`); }
  e.target.value = '';
});

// ------------------------------------------------------------------ files and exports
const binaryWrite = async (path, bytes) => {
  const res = await fetch(`/api/files/write?path=${encodeURIComponent(path)}&force=1&mkdirs=1`, { method: 'PUT', body: bytes, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`couldn't save ${path} (${res.status})`);
};
const baseName = () => (doc.title || 'Untitled song').replace(/[^\w -]/g, '').trim() || 'song';
async function exportAs(kind) {
  const folder = (settings.savePath ? settings.savePath.replace(/\/[^/]*$/, '') : 'Music/Studio');
  try {
    if (kind === 'midi') {
      const path = prompt('Export the MIDI as', `${folder}/${baseName()}.mid`);
      if (!path) return;
      await binaryWrite(path, toSMF(P()));
      await api.files.write(path.replace(/\.midi?$/i, '.notes.md'), notesText(P(), { title: doc.title }), { mkdirs: true, force: true });
      say(`Exported ${path}, with its notes beside it (.notes.md).`);
    } else if (kind === 'bundle') {
      const dir = prompt('Put the bundle in the folder', `${folder}/${baseName()} for AI music`);
      if (!dir) return;
      const files = aiBundle(P(), { title: doc.title, base: baseName().replace(/\s+/g, '_') });
      for (const f of files) { if (f.bytes) await binaryWrite(`${dir}/${f.name}`, f.bytes); else await api.files.write(`${dir}/${f.name}`, f.text, { mkdirs: true, force: true }); }
      say(`Wrote ${files.length} files to ${dir}: the MIDI, one MIDI per track, the notes, the lyrics and a prompt describing the piece.`);
    } else {
      const path = prompt('Export the Prolog form as', `${folder}/${baseName()}.studio.pl`);
      if (path) { await api.files.write(path, toProlog(doc), { mkdirs: true, force: true }); say(`Exported ${path}.`); }
    }
  } catch (err) { say(`Couldn't export: ${err.message}`); }
}
async function save() {
  const path = prompt('Save as (relative to your home folder)', settings.savePath || `Music/Studio/${baseName()}.studio.json`);
  if (!path) return;
  await api.files.write(path, serialise(doc), { mkdirs: true, force: true });
  settings.savePath = path; persist();
  say(`Saved ${path}.`);
}
async function open() {
  const path = prompt('Open a .studio.json, or a .mid file', settings.savePath || '');
  if (!path) return;
  try {
    if (/\.midi?$/i.test(path)) {
      const res = await fetch(api.files.rawUrl(path), { credentials: 'same-origin' });
      doc = newStudioDoc(fromSMF(new Uint8Array(await res.arrayBuffer())), path.split('/').pop().replace(/\.midi?$/i, ''));
    } else {
      const d = deserialise((await api.files.read(path)).content);
      if (d.app !== 'studio') throw new Error('that is not a Studio file');
      doc = d; settings.savePath = path;
    }
    selected = []; persist(); render();
  } catch (err) { say(`Couldn't open it: ${err.message}`); }
}

// ------------------------------------------------------------------ the character
const commands = studioCommands();
const ctx = { selected: () => selected };
const handle = characterHandler(commands, () => doc, (d) => { doc = d; persist(); render(); }, ctx);
async function sayDo(text) {
  if (/^(play|play it|play the song)$/i.test(text.trim())) { await play(); say('Playing.'); return; }
  if (/^stop$/i.test(text.trim())) { stop(); say('Stopped.'); return; }
  const reply = await handle({ intent: 'unknown', text }, text);
  say(reply ?? `I don't know how to do that in Studio. ${commands.help()}`);
}
$('say').addEventListener('submit', async (e) => { e.preventDefault(); await sayDo($('sayText').value); $('sayText').value = ''; });
addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'lucianos.command') return;
  const reply = await handle({ intent: 'unknown', text: e.data.text }, e.data.text);
  e.source.postMessage({ type: 'lucianos.reply', id: e.data.id, text: reply }, location.origin);
});
if (parent !== window) parent.postMessage({ type: 'lucianos.commands', names: commands.list().map((c) => c.name) }, location.origin);

// ------------------------------------------------------------------ start
async function init() {
  settings = { ...settings, ...((await api.state.get('studio').catch(() => null)) ?? {}) };
  const d = await api.state.get('studio-doc').catch(() => null);
  if (d?.format === 'lucianoffice/1' && d.app === 'studio') doc = d;
  $('grid').replaceChildren(...Object.entries(GRIDS).map(([k, v]) => el('option', { value: k, textContent: v })));
  $('tabs').replaceChildren(...SIDES.map(([id, name]) => el('button', { type: 'button', textContent: name, dataset: { side: id }, onclick: () => { side = id; renderSide(); } })));
  $('bpm').onchange = () => { const n = Number($('bpm').value); if (n >= 20 && n <= 300) change(update(P(), (q) => { q.bpm = n; }), 'changed the tempo'); };
  $('sig').onchange = () => { const [num, den] = $('sig').value.split('/').map(Number); change(update(P(), (q) => { q.num = num; q.den = den; }), 'changed the time signature'); };
  $('grid').onchange = () => change(update(P(), (q) => { q.grid = $('grid').value; }), 'changed the snap');
  $('zoom').oninput = () => { doc = apply(doc, projectOps(update(P(), (q) => { q.zoom = Number($('zoom').value); })), { by: 'user', label: 'zoomed' }); render(); };
  $('zoom').onchange = persist;
  $('quantise').onclick = () => { if (!selected.length) { say('Select the clips to quantise.'); return; } let q = P(); for (const id of selected) q = quantiseClip(q, id, q.grid === 'off' ? 'beat' : q.grid); change(q, 'quantised'); say(`Quantised to ${GRIDS[q.grid === 'off' ? 'beat' : q.grid].toLowerCase()}s.`); };
  $('play').onclick = () => (player ? stop() : play());
  $('stop').onclick = () => { stop(); playhead = 0; placePlayhead(); };
  $('rec').onclick = toggleRecord;
  $('importMC').onclick = importMC;
  $('addTrack').onchange = (e) => { const k = e.target.value; e.target.value = ''; if (k) change(addTrack(P(), { kind: k, program: { midi: 0, guitar: 25, vocal: 52 }[k] }).p, 'added a track'); };
  $('ruler').addEventListener('pointerdown', (e) => { const r = $('ruler').getBoundingClientRect(); playhead = snap(P(), (e.clientX - r.left) / pxPerTick(P())); placePlayhead(); });
  $('tracks').addEventListener('pointerdown', (e) => { if (e.target.closest('.clip')) return; selected = []; render(); });
  $('title').onchange = () => { doc = apply(doc, [{ op: 'title', value: $('title').value.trim() || 'Untitled song' }], { by: 'user', label: 'renamed' }); persist(); };
  $('undo').onclick = () => { doc = undo(doc).doc; persist(); render(); };
  $('redo').onclick = () => { doc = redo(doc).doc; persist(); render(); };
  $('new').onclick = () => { if (confirm('Start a new song? The current one stays saved if you saved it.')) { doc = newStudioDoc(newProject()); selected = []; playhead = 0; settings.savePath = ''; persist(); render(); } };
  $('save').onclick = save;
  $('open').onclick = open;
  $('export').onchange = async (e) => { const k = e.target.value; e.target.value = ''; if (k) await exportAs(k); };
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); doc = (e.shiftKey ? redo(doc) : undo(doc)).doc; persist(); render(); return; }
    if (e.key === ' ') { e.preventDefault(); player ? stop() : play(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) { e.preventDefault(); change(removeClips(P(), selected), 'deleted'); selected = []; return; }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.length) { e.preventDefault(); change(nudge(P(), selected, e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey), 'nudged'); }
  });
  render();
  const params = new URLSearchParams(location.search);
  if (params.get('do')) await sayDo(params.get('do'));
}
init();
