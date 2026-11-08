// Guitar and sung-lyric parts. A guitar part is written as chords ("C G Am F", one chord per
// beat-group) and a strum pattern ("D DU UDU"); each strum plays the chord's strings a few
// ticks apart, low to high going down and high to low going up. A sung part puts a lyric's
// syllables on a melody's notes, one syllable a note, and exports them as MIDI lyric events.

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], aug: [0, 4, 8], 5: [0, 7] };
// Open shapes (low E to high E, -1 = not played) for the chords guitarists play most.
const SHAPES = {
  C: [-1, 3, 2, 0, 1, 0], G: [3, 2, 0, 0, 0, 3], D: [-1, -1, 0, 2, 3, 2], A: [-1, 0, 2, 2, 2, 0], E: [0, 2, 2, 1, 0, 0],
  Am: [-1, 0, 2, 2, 1, 0], Em: [0, 2, 2, 0, 0, 0], Dm: [-1, -1, 0, 2, 3, 1], F: [1, 3, 3, 2, 1, 1], Bm: [-1, 2, 4, 4, 3, 2],
  G7: [3, 2, 0, 0, 0, 1], C7: [-1, 3, 2, 3, 1, 0], D7: [-1, -1, 0, 2, 1, 2], A7: [-1, 0, 2, 0, 2, 0], E7: [0, 2, 0, 1, 0, 0]
};
const OPEN = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

export function parseChord(name) {
  const m = /^([A-G](?:#|b)?)(maj7|m7|sus2|sus4|dim|aug|m|7|5)?$/.exec(String(name).trim());
  if (!m) return null;
  return { name: m[0], root: PC[m[1]], quality: m[2] ?? '', intervals: QUALITY[m[2] ?? ''] };
}

// The guitar's notes for a chord: an open shape if there is one, else a voicing from E2 up.
export function voicing(name) {
  if (SHAPES[name]) return SHAPES[name].map((f, s) => (f < 0 ? null : OPEN[s] + f)).filter((x) => x !== null);
  const c = parseChord(name);
  if (!c) return [];
  let root = 40 + ((c.root - 4 + 12) % 12); // root on the low strings, E2..D#3
  const out = [];
  for (const oct of [0, 12]) for (const iv of c.intervals) out.push(root + oct + iv);
  return [...new Set(out)].sort((a, b) => a - b).slice(0, 6);
}

// Notes for "C G Am F" with a pattern per bar, e.g. "D DU UDU" = strums on beats 1, 2, 2.5,
// 3.5, 4, 4.5 (each letter is a half-beat slot; a space is a slot with no strum).
export function guitarNotes(chords, { pattern = 'D DU UDU', barsPerChord = 1, ticksPerBeat = 480, beatsPerBar = 4, spread = 12, velocity = 80 } = {}) {
  const names = String(chords).split(/[\s,|]+/).filter(Boolean);
  const bad = names.filter((n) => !parseChord(n));
  if (bad.length) throw new Error(`I don't know the chord${bad.length > 1 ? 's' : ''} ${bad.join(', ')}`);
  const slot = ticksPerBeat / 2;
  const slots = [...pattern.padEnd(beatsPerBar * 2, ' ')].slice(0, beatsPerBar * 2);
  const notes = [];
  names.forEach((name, ci) => {
    const strings = voicing(name);
    for (let bar = 0; bar < barsPerChord; bar++) {
      const barStart = (ci * barsPerChord + bar) * beatsPerBar * ticksPerBeat;
      slots.forEach((s, k) => {
        if (s !== 'D' && s !== 'U') return;
        // the strum lasts until the next strum
        let next = k + 1; while (next < slots.length && slots[next] !== 'D' && slots[next] !== 'U') next++;
        const len = (next - k) * slot;
        const order = s === 'D' ? strings : [...strings].reverse().slice(0, 4); // up-strums catch the top strings
        order.forEach((pitch, j) => notes.push({ tick: barStart + k * slot + j * spread, duration: Math.max(30, len - j * spread), pitch, velocity: s === 'D' ? velocity : velocity - 15 }));
      });
    }
  });
  return notes;
}

// Syllables, roughly: words split before a consonant that follows a vowel group
// ("medi-ta-tion"); hyphens in the lyric are kept as you wrote them.
export function syllables(text) {
  const out = [];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (word.includes('-')) { const parts = word.split('-').filter(Boolean); parts.forEach((p, i) => out.push(i < parts.length - 1 ? `${p}-` : p)); continue; }
    const parts = word.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi);
    const joined = parts?.join('') ?? '';
    if (!parts || joined.length !== word.length || parts.length === 1) { out.push(word); continue; }
    // a silent e at the end belongs to the syllable before it ("peace", "time")
    if (parts.length > 1 && /^[^aeiouy]+e$/i.test(parts.at(-1))) parts.splice(-2, 2, parts.at(-2) + parts.at(-1));
    if (parts.length === 1) { out.push(word); continue; }
    parts.forEach((p, i) => out.push(i < parts.length - 1 ? `${p}-` : p));
  }
  return out;
}

// Put the lyric's syllables on the melody's notes, in order. Extra syllables go on the last
// note; extra notes are held over (a "melisma"). Returns notes with a lyric each.
export function singNotes(melody, text) {
  const syl = syllables(text);
  const notes = [...melody].sort((a, b) => a.tick - b.tick).map((n) => ({ ...n }));
  notes.forEach((n, i) => { if (i < syl.length) n.lyric = syl[i]; });
  if (syl.length > notes.length && notes.length) notes[notes.length - 1].lyric += ` ${syl.slice(notes.length).join(' ')}`;
  return notes;
}

// The vowel of a syllable, for the sung voice in the browser (formants in Hz).
export const VOWELS = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240] };
export const vowelOf = (syl) => (/[aeiou]/i.exec(String(syl).replace(/y$/, 'i'))?.[0] ?? 'a').toLowerCase();
