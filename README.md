# Studio

Studio is the Sound Sequencer MR of [Lucian Office](https://github.com/luciangreen/lucianoffice), running inside [LucianOS](https://github.com/luciangreen/lucianos). It arranges sequences of MIDI samples, each with a note on how to interpret it, written as text beside the MIDI.

- **Arranging**: tracks of clips (MIDI samples) that may overlap. Drag a clip to move it (across tracks too), snapping to the grid. Hold **Shift** to line it up with the edges of other clips and bar lines (the ruler). Arrow keys nudge by the snap (Shift: a bar). Zoom from 25% to 400%; bars, BPM and time signature (4/4, 3/4, 6/8, 2/4); snap to bars, beats, half beats, triplets, quarter or eighth beats, or off.
- **Quantise** the selected clips to the snap grid, or say "quantise the chorus to eighth notes". Strength can be partial (in the library).
- **Hum notes**: press **● Hum**, hum one note at a time and press **Stop humming**. Each note's pitch is found with the YIN method and steady stretches become notes, with velocity from how loudly you hummed. They go on a Humming track at the playhead's bar, quantised to the grid if you like.
- **Guitar**: chords (one a bar) and a strum pattern ("D DU UDU": down and up strums in half-beat slots). Each strum plays the chord's strings a few ticks apart, low to high going down, high to low going up. Open shapes are used for the common chords, with voicings built for the rest. Played with plucked strings.
- **Sung lyrics**: words on a melody, one syllable a note (hyphens split words your way). Played with a sung vowel and exported as MIDI lyric events.
- **Music-Composer songs**: load a `song….mid` with its `song…_meta.txt` (from the file in your home folder, or from your device). Each section of the form (intro, verses, chorus, instrumentals, solo, outro: four bars each) becomes a clip on each track that plays in it, named from the form, with the lyrics from the meta file. In **Sections**, audition each one and tag it as **background music**, a **sound effect**, a **vocal effect**, or to **expand in Music-Composer**.
- **Notes on how to interpret it**: each clip has a tag and a note ("character name y, but cute"; "quiet, then build").
- **Export**:
  - **MIDI and notes**: a format 1 `.mid` with one track per Studio track, section markers (with tags), lyrics and the interpretation notes as text events. Beside it is a `.notes.md`: the tracks, then each clip with its bars, range, tag, how to interpret it and its lyrics.
  - **Bundle for AI music tools**: the MIDI, one MIDI file per track, the notes, the lyrics, the project and a prompt describing the piece (tempo, instruments, sections in order, uses, notes). It is written from the project, with no AI.
  - The **Prolog form** of the document.
- **Undo** every change, yours or the character's. Tell the character: "set the tempo to 90", "snap to eighth notes", "quantise it", "tag the chorus as background music", "note on the intro: quiet, then build", "move the solo to bar 9", "transpose the verse up 2", "mute the piano", "add a guitar part C G Am F", "sing "calm in ten minutes" on the verse", "zoom to 150%", "play", "stop", "undo that".

Playback uses LucianOS's General MIDI voices (`/shared/gm.js`) for MIDI tracks, plucked strings for guitar and a sung vowel for lyrics. It works on a phone; the microphone needs the page to be opened over HTTPS or on localhost.

## Install

From your `lucianos` folder:

```sh
git clone https://github.com/luciangreen/lucianoffice apps/lucianoffice
git clone https://github.com/luciangreen/studio apps/studio
```

## Tests

```sh
npm test
```

The tests cover:

- **MIDI files** written and read back in ticks, with names, programs, lyrics, markers and text.
- **Music-Composer songs** cut into named sections, with their lyrics; numbered sections when there is no meta file.
- **Arranging**: the grid, snapping, Shift alignment, nudging, overlapping and duplicating.
- **Quantising**, and the **export round trip**: a quantised project exported to MIDI and read back gives the same notes, sections, tags, notes and lyrics.
- **Humming**: three tunes from a low man's to a high woman's range, sung with harmonics, vibrato, pitch drift and breath noise at 44.1 and 48 kHz. Every note's pitch is found within a semitone, and silence gives no notes.
- **Guitar** strums and **sung** syllables.
- The **notes**, the **prompt** and the **AI bundle**.
- The **character's commands**, with undo.

## Inputs and outputs

`io/ios.txt` lists 200 inputs and the outputs they give, from real runs of this repo's functions (the list of functions is in `io/cases.mjs`; the inputs come from a fixed seed, so they are the same every time). `npm test` runs them again and fails if any output changes. If a change is meant, run `npm run ios` to write the new outputs and check the diff.
