import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSMF, songOf, writeSMF, hzToMidi, noteName } from '../lib/smf.js';
import { addClip, addTrack, align, arranged, barBeat, clipLength, duplicateClip, gridTicks, moveClip, newProject, nudge, quantise, quantiseClip, snap, ticksPerBar } from '../lib/project.js';
import { importComposer, parseMeta, sectionName } from '../lib/composer.js';
import { humToNotes, pitchTrack, synthHum, yin } from '../lib/hum.js';
import { guitarNotes, parseChord, singNotes, syllables, voicing } from '../lib/parts.js';
import { aiBundle, fromSMF, notesText, prompt, toSMF } from '../lib/export.js';
import { findClips, newStudioDoc, projectOf, studioCommands } from '../lib/commands.js';

// A song as Music-Composer writes it: 384 ticks a beat, tempo 63, 4/4, four bars a section.
function composerSong(form = ['n', 'v1', 'c']) {
  const bar = 384 * 4;
  const vocal = [], piano = [], strings = [];
  form.forEach((code, si) => {
    const s = si * bar * 4;
    if (code !== 'n') for (let b = 0; b < 4; b++) vocal.push({ tick: s + b * bar, duration: 384, pitch: 60 + b, velocity: 100 });
    for (let b = 0; b < 4; b++) piano.push({ tick: s + b * bar, duration: bar, pitch: 48 + (si % 3), velocity: 80 });
    if (code === 'c') strings.push({ tick: s, duration: bar * 4, pitch: 55, velocity: 70 });
  });
  return writeSMF({ division: 384, bpm: 63.00009, parts: [
    { name: '"Calm in ten minutes"', channel: 1, program: 52, notes: vocal },
    { name: '', channel: 2, program: 0, notes: piano },
    { name: '', channel: 3, program: 48, notes: strings }
  ] });
}
const META = `[[form,[n,v1,c]],[chord_progressions,[classical]],[voice_part,[v1,c]],[melody,[[v,[c,d,e]],[c,[g,a,b]]]],[melody_instruments,[[0,"Acoustic Grand Piano"]]],[harmony_instruments,[[48,"String Ensemble 1"]]],[lyrics,[[v1,["Calm","in","ten","minutes"],["Breathe","in","and","out"],["Let","the","day","go"],["Find","your","quiet","place"]],[c,["Peace","is","here"],["Now","and","then"],["Rest","a","while"],["All","is","well"]]]],[genre,["anthem"]],[rhythm,[]]]`;

test('MIDI files: written and read back in ticks, with names, programs, lyrics, markers and text', () => {
  const bytes = writeSMF({ division: 480, bpm: 90, num: 3, den: 4, markers: [{ tick: 0, text: 'Intro [Background music]' }], texts: [{ tick: 0, text: 'Intro: quiet' }],
    parts: [{ name: 'Vocal ♪', channel: 0, program: 52, notes: [{ tick: 0, duration: 480, pitch: 60, velocity: 90 }, { tick: 480, duration: 480, pitch: 60, velocity: 70 }], lyrics: [{ tick: 0, text: 'me-' }, { tick: 480, text: 'di' }] }] });
  const song = songOf(readSMF(bytes));
  assert.deepEqual([song.division, song.bpm, song.num, song.den], [480, 90, 3, 4]);
  // a note ending as the next starts, on the same pitch, stays two notes
  assert.deepEqual(song.notes.map((n) => [n.tick, n.duration, n.pitch, n.velocity, n.program]), [[0, 480, 60, 90, 52], [480, 480, 60, 70, 52]]);
  assert.deepEqual(song.lyrics.map((l) => l.text), ['me-', 'di']);
  assert.deepEqual([song.markers[0].text, song.texts[0].text, song.names[1]], ['Intro [Background music]', 'Intro: quiet', 'Vocal ♪']);
  assert.equal(noteName(61), 'C#4');
  assert.equal(Math.round(hzToMidi(261.63)), 60);
  assert.throws(() => readSMF(new Uint8Array([1, 2, 3, 4])), /not a MIDI file/);
});

test('Music-Composer songs are cut into named sections, with lyrics from the meta file', () => {
  const meta = parseMeta(META);
  assert.deepEqual(meta.form, ['n', 'v1', 'c']);
  assert.equal(meta.harmony_instruments[0][1], 'String Ensemble 1');
  assert.deepEqual([sectionName('n'), sectionName('v1'), sectionName('t2'), sectionName('c')], ['Intro', 'Verse 1', 'Instrumental 2', 'Chorus']);
  const { project: p, sections } = importComposer(composerSong(), META, { file: 'song2026118.mid' });
  assert.deepEqual([p.division, p.bpm, p.num], [384, 63, 4]);
  assert.deepEqual(sections.map((s) => [s.name, s.bar]), [['Intro', 1], ['Verse 1', 5], ['Chorus', 9]]);
  assert.deepEqual(p.tracks.map((t) => [t.name, t.program, t.channel]), [['Track 1', 52, 1], ['Track 2', 0, 2], ['Track 3', 48, 3]]);
  // the intro has piano only; the chorus has all three
  assert.deepEqual(p.clips.filter((c) => c.name === 'Intro').map((c) => c.track), ['t2']);
  assert.deepEqual(p.clips.filter((c) => c.name === 'Chorus').map((c) => c.track), ['t1', 't2', 't3']);
  const verse = p.clips.find((c) => c.name === 'Verse 1' && c.track === 't1');
  assert.deepEqual([verse.start, verse.length, verse.notes[0].tick, verse.notes.length], [384 * 16, 384 * 16, 0, 4]);
  assert.match(verse.lyricsText, /^Calm in ten minutes\nBreathe in and out/);
  assert.equal(verse.source.section, 'v1');
  // without the meta file, the sections are numbered
  assert.deepEqual(importComposer(composerSong()).sections.map((s) => s.name), ['Section 1', 'Section 2', 'Section 3']);
});

test('arranging: the grid, snapping, Shift ruler alignment, nudging and overlapping clips', () => {
  let p = newProject({ bpm: 120 });
  assert.deepEqual([ticksPerBar(p), gridTicks(p, '1/2'), gridTicks(p, '1/3'), barBeat(p, 480 * 5)], [1920, 240, 160, '2.2']);
  assert.equal(snap(p, 700), 480);
  assert.equal(snap(p, 700, 'bar'), 0);
  let r = addClip(p, { name: 'A', start: 0, notes: [{ tick: 0, duration: 1900, pitch: 60, velocity: 90 }] }); p = r.p; const a = r.id;
  assert.equal(clipLength(p, p.clips[0]), 1920);
  r = addClip(p, { name: 'B', start: 3000, notes: [{ tick: 0, duration: 480, pitch: 64, velocity: 90 }] }); p = r.p; const b = r.id;
  // Shift-drag B near the end of A: it lines up with A's end; far from any edge: the grid
  assert.equal(align(p, 2050, { clipId: b, length: 480 }), 1920);
  assert.equal(align(p, 1500, { clipId: b, length: 480 }), 1440); // B's end on A's end
  assert.equal(align(p, 3100, { clipId: b, length: 480, within: 50 }), 2880);
  // overlapping is allowed
  p = moveClip(p, b, 960);
  assert.deepEqual(arranged(p).map((n) => [n.tick, n.pitch]), [[0, 60], [960, 64]]);
  p = nudge(p, [b], 1); assert.equal(p.clips[1].start, 1440);
  p = nudge(p, [b], -1, true); assert.equal(p.clips[1].start, 0);
  p = nudge(p, [b], -1); assert.equal(p.clips[1].start, 0);
  const d = duplicateClip(p, a); assert.equal(d.p.clips[2].start, 1920);
  const t = addTrack(p, { kind: 'guitar', program: 25 });
  assert.equal(t.p.tracks[1].channel, 1);
});

test('quantising moves notes to the grid, fully or partly, and the round trip through MIDI keeps them', () => {
  const played = [{ tick: 10, duration: 230, pitch: 60, velocity: 90 }, { tick: 470, duration: 250, pitch: 62, velocity: 80 }, { tick: 735, duration: 200, pitch: 64, velocity: 85 }];
  assert.deepEqual(quantise(played, 240).map((n) => [n.tick, n.duration]), [[0, 240], [480, 240], [720, 240]]);
  assert.deepEqual(quantise(played, 240, { strength: 0.5, ends: false }).map((n) => [n.tick, n.duration]), [[5, 230], [475, 250], [728, 200]]);
  // quantise a clip, export, read back: the same notes, sections, tags, notes and lyrics
  let p = newProject({ bpm: 96 });
  let r = addClip(p, { name: 'Verse', start: 1920, notes: played.map((n, i) => ({ ...n, lyric: ['calm', 'in', 'ten'][i] })), tag: 'vocal', interpret: 'soft, like a lullaby' }); p = r.p;
  p = quantiseClip(p, r.id, '1/2');
  r = addClip(p, { name: 'Chorus', start: 3840, notes: [{ tick: 0, duration: 960, pitch: 67, velocity: 100 }], tag: 'background' }); p = r.p;
  const back = fromSMF(toSMF(p));
  assert.deepEqual(arranged(back).map((n) => [n.tick, n.duration, n.pitch, n.velocity, n.lyric ?? '']), arranged(p).map((n) => [n.tick, n.duration, n.pitch, n.velocity, n.lyric ?? '']));
  assert.deepEqual(arranged(p).map((n) => n.tick), [1920, 2400, 2640, 3840]);
  assert.deepEqual(back.clips.map((c) => [c.name, c.start, c.tag, c.interpret]), [['Verse', 1920, 'vocal', 'soft, like a lullaby'], ['Chorus', 3840, 'background', '']]);
  assert.equal(back.bpm, 96);
});

test('humming: the pitch of each note is found within a semitone', () => {
  // a 440 Hz frame is A4
  const f = new Float32Array(1024).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 22050) + 0.4 * Math.sin((4 * Math.PI * 440 * i) / 22050));
  assert.ok(Math.abs(yin(f, 22050).hz - 440) < 2);
  // tunes across a low man's to a high woman's range, with vibrato, drift, breath noise and harmonics
  const tunes = [
    [{ midi: 57, dur: 0.5 }, { midi: 60, dur: 0.4 }, { midi: 64, dur: 0.4 }, { midi: 62, dur: 0.6 }],
    [{ midi: 45, dur: 0.6 }, { midi: 47, dur: 0.3 }, { midi: 48, dur: 0.3 }, { midi: 52, dur: 0.8 }],
    [{ midi: 72, dur: 0.35 }, { midi: 76, dur: 0.35 }, { midi: 79, dur: 0.35 }, { midi: 74, dur: 0.5 }, { midi: 71, dur: 0.7 }]
  ];
  for (const [i, tune] of tunes.entries()) {
    for (const rate of [44100, 48000]) {
      const hum = synthHum(tune, rate, { seed: i + 3, vibrato: 0.35, drift: 0.2, noise: 0.03 });
      const notes = humToNotes(hum, rate, { bpm: 120 });
      assert.equal(notes.length, tune.length, `tune ${i} at ${rate}: ${notes.map((n) => n.pitch)}`);
      notes.forEach((n, k) => assert.ok(Math.abs(n.pitch + n.cents / 100 - tune[k].midi) < 1, `note ${k}: ${n.pitch} ${n.cents} vs ${tune[k].midi}`));
      // the first note starts 0.1 s in: at 120 BPM, a fifth of a beat
      assert.ok(Math.abs(notes[0].tick - 96) <= 20, `start ${notes[0].tick}`);
    }
  }
  // silence gives no notes
  assert.deepEqual(humToNotes(new Float32Array(22050), 44100), []);
  assert.ok(pitchTrack(synthHum([{ midi: 60, dur: 0.3 }]), 44100).some((p) => p.midi !== null));
});

test('guitar strums and sung lyrics', () => {
  assert.deepEqual(voicing('G'), [43, 47, 50, 55, 59, 67]);
  assert.deepEqual(voicing('F#m'), [42, 45, 49, 54, 57, 61]);
  assert.equal(parseChord('H7'), null);
  const notes = guitarNotes('C G', { pattern: 'D DU' });
  // C: a down-strum on beat 1 (low to high, 12 ticks apart), then on beat 2, then an up-strum
  assert.deepEqual(notes.filter((n) => n.tick < 480).map((n) => [n.tick, n.pitch]), [[0, 48], [12, 52], [24, 55], [36, 60], [48, 64]]);
  assert.deepEqual(notes.filter((n) => n.tick >= 720 && n.tick < 800).map((n) => n.pitch), [64, 60, 55, 52]);
  assert.equal(notes.filter((n) => n.tick >= 1920 && n.tick < 1930)[0].pitch, 43);
  assert.throws(() => guitarNotes('C X9'), /don't know the chord X9/);
  assert.deepEqual(syllables('meditation is calm to-day'), ['me-', 'di-', 'ta-', 'tion', 'is', 'calm', 'to-', 'day']);
  const sung = singNotes([{ tick: 0, pitch: 60 }, { tick: 480, pitch: 62 }, { tick: 960, pitch: 64 }], 'peace be with you');
  assert.deepEqual(sung.map((n) => n.lyric), ['peace', 'be', 'with you']);
});

test('the notes beside the MIDI, the prompt, and the bundle for AI music tools', () => {
  const { project } = importComposer(composerSong(), META, { file: 'song2026118.mid' });
  let p = project;
  p.clips.find((c) => c.name === 'Chorus' && c.track === 't3').tag = 'background';
  p.clips.find((c) => c.name === 'Intro').interpret = 'character name y, but cute';
  const text = notesText(p, { title: 'Calm' });
  assert.match(text, /^# Calm\n\n63 BPM, 4\/4, 12 bars \(46 seconds\)\./);
  assert.match(text, /### Intro \(bar 1\.1 to 5\.1, Track 2\)\n4 notes, C3–C3\.\nHow to interpret it: character name y, but cute/);
  assert.match(text, /Tag: Background music\./);
  assert.match(text, /Lyrics \(from Music-Composer\): Calm in ten minutes \/ Breathe in and out/);
  assert.match(prompt(p, { title: 'Calm', style: 'gentle anthem' }), /^"Calm", gentle anthem, 63 BPM in 4\/4\.\nInstruments: Choir Aahs, Acoustic Grand Piano, String Ensemble 1\.\nSections in order: Intro, Verse 1, Chorus\.\nUses: background music\.\nNotes: Intro: character name y, but cute/);
  const files = aiBundle(p, { title: 'Calm', base: 'calm' });
  assert.deepEqual(files.map((f) => f.name), ['calm.mid', 'calm.notes.md', 'calm.prompt.txt', 'calm.studio.json', 'calm.lyrics.txt', 'calm.Track_1.mid', 'calm.Track_2.mid', 'calm.Track_3.mid']);
  assert.equal(songOf(readSMF(files[5].bytes)).notes.length, 8);
});

test('the character arranges the song, and its changes can be undone', async () => {
  const { project } = importComposer(composerSong(), META);
  let doc = newStudioDoc(project, 'Calm');
  const cmds = studioCommands();
  let selected = [];
  const say = async (text) => { const r = await cmds.perform(text, doc, { ctx: { selected: () => selected } }); assert.ok(r.matched, `understood "${text}"`); doc = r.doc; return r.say; };
  assert.equal(findClips(projectOf(doc), 'the chorus on track 3').length, 1);
  assert.equal(findClips(projectOf(doc), 'chorus').length, 3);
  assert.match(await say('set the tempo to 90'), /90 BPM/);
  assert.match(await say('snap to eighth notes'), /half beats/);
  assert.match(await say('tag the chorus as background music'), /Chorus: background music/);
  assert.deepEqual(projectOf(doc).clips.filter((c) => c.name === 'Chorus').map((c) => c.tag), ['background', 'background', 'background']);
  assert.match(await say('note on the intro: quiet, then build'), /Noted on Intro/);
  assert.match(await say('transpose the verse up 2'), /up 2/);
  assert.equal(projectOf(doc).clips.find((c) => c.name === 'Verse 1' && c.track === 't1').notes[0].pitch, 62);
  assert.match(await say('move the chorus to bar 13'), /bar 13/);
  assert.equal(projectOf(doc).clips.find((c) => c.name === 'Chorus').start, 12 * 1536);
  assert.match(await say('add a guitar part C G Am F'), /guitar part \(C G Am F, strummed D DU UDU\)/);
  assert.equal(projectOf(doc).tracks.at(-1).program, 25);
  assert.match(await say('sing "peace is here now" on the verse on track 1'), /4 syllables on 4 notes/);
  assert.match(await say('mute track 2'), /Track 2 is muted/);
  assert.match(await say('zoom to 150%'), /150%/);
  selected = [projectOf(doc).clips.find((c) => c.name === 'Intro').id];
  assert.match(await say('quantise it'), /Quantised Intro to half beats/);
  assert.match(await say('tag nonsense as background'), /can't find nonsense/);
  await say('undo that');
  await say('undo that');
  assert.equal(projectOf(doc).tracks.find((t) => t.name === 'Track 2').mute, true);
  await say('undo that');
  assert.equal(projectOf(doc).tracks.find((t) => t.name === 'Track 2').mute, false);
});
