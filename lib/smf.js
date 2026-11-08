// Standard MIDI files, read and written in ticks, keeping what Studio needs for a lossless
// round trip: tracks and their names, tempo and time signature, programs, notes, lyrics,
// markers (Studio's section names and tags) and text (the notes on how to interpret them).

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const noteName = (p) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

const latin1 = (s) => [...String(s)].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
const utf8 = (s) => [...new TextEncoder().encode(String(s))];

// Read: { format, division, tracks: [{ name, events: [{ tick, type, ... }] }] }
//   types: note (pitch, velocity, duration, channel), program (channel, program), tempo (bpm),
//   timesig (num, den), lyric/marker/text/name (text), cc (channel, cc, value)
export function readSMF(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0;
  const u8 = () => b[pos++];
  const u16 = () => (b[pos++] << 8) | b[pos++];
  const u32 = () => ((b[pos++] << 24) >>> 0) + (b[pos++] << 16) + (b[pos++] << 8) + b[pos++];
  const str = (n) => String.fromCharCode(...b.subarray(pos, (pos += n)));
  const text = (n) => { const bytes = b.subarray(pos, (pos += n)); try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return String.fromCharCode(...bytes); } };
  const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { const c = u8(); v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return v; };
  if (str(4) !== 'MThd') throw new Error('this is not a MIDI file');
  const hlen = u32(); const format = u16(); const ntracks = u16(); const division = u16();
  pos = 8 + hlen;
  if (division & 0x8000) throw new Error('SMPTE timing is not supported');
  const tracks = [];
  for (let t = 0; t < ntracks && pos < b.length; t++) {
    if (str(4) !== 'MTrk') throw new Error('a MIDI track is damaged');
    const len = u32(); const end = pos + len;
    let tick = 0, status = 0;
    const events = []; const open = new Map(); let name = '';
    while (pos < end) {
      tick += vlq();
      let s = b[pos];
      if (s & 0x80) pos++; else s = status;
      if (s === 0xff) {
        const type = u8(); const l = vlq();
        if (type === 0x51 && l === 3) { events.push({ tick, type: 'tempo', bpm: Math.round((60e6 / ((b[pos] << 16) | (b[pos + 1] << 8) | b[pos + 2])) * 1000) / 1000 }); pos += l; }
        else if (type === 0x58 && l >= 2) { events.push({ tick, type: 'timesig', num: b[pos], den: 2 ** b[pos + 1] }); pos += l; }
        else if (type === 0x03) { name = text(l); events.push({ tick, type: 'name', text: name }); }
        else if (type === 0x05) events.push({ tick, type: 'lyric', text: text(l) });
        else if (type === 0x06) events.push({ tick, type: 'marker', text: text(l) });
        else if (type === 0x01) events.push({ tick, type: 'text', text: text(l) });
        else { pos += l; if (type === 0x2f) break; }
      } else if (s === 0xf0 || s === 0xf7) pos += vlq();
      else {
        status = s;
        const kind = s >> 4, ch = s & 0x0f;
        if (kind === 0x9 || kind === 0x8) {
          const pitch = u8(), vel = u8();
          const key = `${ch}:${pitch}`;
          if (kind === 0x9 && vel > 0) { const e = { tick, type: 'note', pitch, velocity: vel, duration: 0, channel: ch }; events.push(e); if (!open.has(key)) open.set(key, []); open.get(key).push(e); }
          else { const e = open.get(key)?.shift(); if (e) e.duration = tick - e.tick; }
        } else if (kind === 0xc) events.push({ tick, type: 'program', channel: ch, program: u8() & 0x7f });
        else if (kind === 0xb) { const cc = u8(), value = u8(); events.push({ tick, type: 'cc', channel: ch, cc, value }); }
        else if (kind === 0xd) pos += 1; else pos += 2;
      }
    }
    for (const stack of open.values()) for (const e of stack) e.duration = Math.max(1, tick - e.tick);
    pos = end;
    tracks.push({ name, events });
  }
  return { format, division, tracks };
}

// The first tempo and time signature, and every note with its track, channel and program.
export function songOf(smf) {
  let bpm = 120, num = 4, den = 4;
  const all = smf.tracks.flatMap((t) => t.events);
  const tempo = all.filter((e) => e.type === 'tempo').sort((a, b) => a.tick - b.tick)[0];
  const ts = all.filter((e) => e.type === 'timesig').sort((a, b) => a.tick - b.tick)[0];
  if (tempo) bpm = tempo.bpm;
  if (ts) { num = ts.num; den = ts.den; }
  const notes = [];
  smf.tracks.forEach((t, ti) => {
    const program = Array(16).fill(0);
    for (const e of [...t.events].sort((a, b) => a.tick - b.tick || (a.type === 'program' ? -1 : 1))) {
      if (e.type === 'program') program[e.channel] = e.program;
      if (e.type === 'note') notes.push({ track: ti, tick: e.tick, duration: e.duration, pitch: e.pitch, velocity: e.velocity, channel: e.channel, program: program[e.channel] });
    }
  });
  notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const meta = (type) => smf.tracks.flatMap((t, ti) => t.events.filter((e) => e.type === type).map((e) => ({ ...e, track: ti })));
  return { division: smf.division, bpm, num, den, notes, lyrics: meta('lyric'), markers: meta('marker'), texts: meta('text'), names: smf.tracks.map((t) => t.name) };
}

// Write a format 1 file: the first track holds tempo, time signature, markers and texts; one
// track per part after it, each with its name, channel, program, notes and lyrics.
//   { division, bpm, num, den, markers: [{ tick, text }], texts: [{ tick, text }],
//     parts: [{ name, channel, program, notes: [{ tick, duration, pitch, velocity }], lyrics: [{ tick, text }] }] }
export function writeSMF({ division = 480, bpm = 120, num = 4, den = 4, markers = [], texts = [], parts = [] }) {
  const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; };
  const metaEv = (tick, type, bytes) => ({ tick, order: 0, data: [0xff, type, ...vlq(bytes.length), ...bytes] });
  const chunk = (events) => {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const out = []; let last = 0;
    for (const e of events) { out.push(...vlq(Math.max(0, Math.round(e.tick) - last)), ...e.data); last = Math.max(last, Math.round(e.tick)); }
    out.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, (out.length >>> 24) & 255, (out.length >>> 16) & 255, (out.length >>> 8) & 255, out.length & 255, ...out];
  };
  const us = Math.round(60e6 / bpm);
  const conductor = [
    metaEv(0, 0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]),
    metaEv(0, 0x58, [num, Math.round(Math.log2(den)), 24, 8]),
    ...markers.map((m) => metaEv(m.tick, 0x06, utf8(m.text))),
    ...texts.map((t) => metaEv(t.tick, 0x01, utf8(t.text)))
  ];
  const chunks = [chunk(conductor)];
  for (const p of parts) {
    const ch = (p.channel ?? 0) & 15;
    const ev = [metaEv(0, 0x03, utf8(p.name ?? '')), { tick: 0, order: 1, data: [0xc0 | ch, (p.program ?? 0) & 127] }];
    for (const l of p.lyrics ?? []) ev.push({ ...metaEv(l.tick, 0x05, utf8(l.text)), order: 2 });
    for (const n of p.notes) {
      const t = Math.max(0, Math.round(n.tick)), d = Math.max(1, Math.round(n.duration));
      ev.push({ tick: t, order: 3, data: [0x90 | ch, n.pitch & 127, Math.max(1, Math.min(127, Math.round(n.velocity ?? 90)))] });
      ev.push({ tick: t + d, order: 1.5, data: [0x80 | ch, n.pitch & 127, 0] }); // note-offs before note-ons at the same tick
    }
    chunks.push(chunk(ev));
  }
  const ntr = chunks.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (ntr >> 8) & 255, ntr & 255, (division >> 8) & 255, division & 255, ...chunks.flat()]);
}
export { latin1 };
