// The functions whose inputs and outputs are recorded in io/ios.txt (see io/engine.mjs).
import { noteName, hzToMidi, midiToHz, writeSMF, readSMF, songOf } from '../lib/smf.js';
import { parseChord, voicing, guitarNotes, syllables, singNotes } from '../lib/parts.js';
import { sectionName, parseMeta } from '../lib/composer.js';
import { synthHum, humToNotes } from '../lib/hum.js';
import { newProject, barBeat } from '../lib/project.js';

export const title = 'Studio';

const CHORDS = ['C', 'G', 'Am', 'F', 'Dm7', 'E7', 'Bb', 'F#m', 'Cmaj7', 'Gsus4', 'Ddim', 'A/C#', 'H', ''];

export const cases = [
  { name: 'noteName', run: noteName, make: (rnd) => [rnd.int(21, 108)] },
  { name: 'hzToMidi', run: hzToMidi, make: (rnd) => [rnd.pick([27.5, 110, 220, 261.63, 440, 466.16, 880, rnd.int(60, 2000)])] },
  { name: 'midiToHz', run: midiToHz, make: (rnd) => [rnd.int(21, 108)] },
  { name: 'parseChord', run: parseChord, make: (rnd) => [rnd.pick(CHORDS)] },
  { name: 'voicing', run: voicing, make: (rnd) => [rnd.pick(CHORDS)] },
  { name: 'guitarNotes', run: (chords, pattern) => guitarNotes(chords, { pattern }).slice(0, 12), make: (rnd) => [rnd.some(CHORDS.slice(0, 10), 1, 4), rnd.pick(['D DU UDU', 'D D D D', 'DUDUDUDU', 'D'])] },
  { name: 'syllables', run: syllables, make: (rnd) => [rnd.words(1, 6) + rnd.pick(['', ' beautiful', ' everybody', ' rhythm', ' fire'])] },
  { name: 'singNotes', run: (melody, text) => singNotes(melody, text), make: (rnd) => [Array.from({ length: rnd.int(1, 6) }, (_, i) => ({ tick: i * 480, dur: 480, pitch: rnd.int(55, 76), vel: 90 })), rnd.words(1, 6)] },
  { name: 'sectionName', run: sectionName, make: (rnd) => [rnd.pick(['i', 'v1', 'v2', 'c', 'c2', 'b', 'o', 's', 'pc', 'x', 'V3'])] },
  { name: 'parseMeta', run: parseMeta, make: (rnd) => [`[[${rnd.pick(['A song', 'Garden'])}], [${rnd.int(80, 140)}], [[v1, "${rnd.words(2, 5)}"], [c, "${rnd.words(2, 5)}"]]].`] },
  { name: 'MIDI file round trip', run: (bpm, notes) => songOf(readSMF(writeSMF({ bpm, parts: [{ name: 'Lead', channel: 0, program: 0, notes }] }))), make: (rnd) => [rnd.pick([60, 90, 100, 120, 140]), Array.from({ length: rnd.int(1, 5) }, (_, i) => ({ tick: i * 240, dur: rnd.pick([120, 240, 480]), pitch: rnd.int(48, 84), vel: rnd.int(40, 127) }))] },
  { name: 'humToNotes', run: (notes, bpm) => humToNotes(synthHum(notes, 8000, { seed: 3 }), 8000, { bpm }).map((n) => ({ pitch: n.pitch, tick: n.tick, dur: n.dur })), make: (rnd) => [Array.from({ length: rnd.int(1, 3) }, () => ({ midi: rnd.int(55, 72), seconds: rnd.pick([0.3, 0.5]) })), rnd.pick([90, 100, 120])] },
  { name: 'barBeat', run: (num, tick) => barBeat(newProject({ num }), tick), make: (rnd) => [rnd.pick([3, 4, 6]), rnd.int(0, 30000)] }
];
