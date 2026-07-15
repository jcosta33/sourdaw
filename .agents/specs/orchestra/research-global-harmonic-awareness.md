# Global harmonic awareness and tuning for a Tauri DAW

**A lock-free `[f64; 128]` tuning table, shared via triple buffer between a Rust audio thread and React UI, forms the backbone of project-wide key/scale awareness.** This architecture lets every oscillator, AI tool, and third-party plugin receive microtuning data with zero audio-thread contention. The design draws on battle-tested patterns from Surge XT's open-source tuning library, the MTS-ESP shared-memory protocol, and the Scala ecosystem's .scl/.kbm file formats — combined with a mathematically precise scale-folding algorithm that non-destructively remaps MIDI when users change keys. What follows is the complete technical blueprint.

---

## How leading DAWs handle tuning today

Ableton Live 12 set the current gold standard for DAW-level tuning UX. Its tuning system lives below the Browser sidebar and applies **globally per Live Set**. The critical innovation is **adaptive piano roll visualization**: when a 19-TET tuning loads, the piano roll shows 19 rows per octave instead of 12, each labeled with custom note names drawn from `.ascl` metadata. Individual tracks can bypass the global tuning via an I/O-section toggle, and drum racks bypass automatically. Ableton delivers retuning to instruments via MPE pitch bend (±48 semitones), meaning it works with all MPE-compatible VST2/VST3/AU plugins without any special protocol. The companion web tool at tuning.ableton.com provides an interactive code editor for building custom temperaments with live audio feedback.

Ableton's Core Library ships tunings organized into **EDO** (5 through 72-EDO), **Historical** (meantone, Werckmeister, Pythagorean), **Harmonic Series**, and **Cultural** (Sruti, Arabic maqam) categories. It supports Scala `.scl` import but uses its own `.ascl` format that embeds reference pitch and note names in a single file — eliminating the two-file `.scl`+`.kbm` friction. A "Retune Set On Loading" option snaps existing MIDI notes to the nearest pitch in a newly loaded tuning, and five controller-layout modes (All Keys, Black Only, White Only, Closest in Pitch, Custom) solve the physical-keyboard mapping problem for non-12-TET scales.

**Bitwig Studio** takes a fundamentally different approach: microtuning is a **per-device Note FX** (Micro-pitch), not a global setting. This means different tracks can run different tunings simultaneously, and tuning parameters can be modulated over time — a unique capability. However, Micro-pitch is **limited to 12 notes per octave**, and the piano roll remains fixed at the standard 12-note chromatic grid. For scales exceeding 12 notes, users must rely on plugins like Surge XT. Bitwig 6 added a global key signature and Key Filter+ with three foreign-note modes (Filter, Keep, Constrain), plus Grid modules for scale-degree transposition.

**FL Studio** has no DAW-level microtuning. Users resort to per-plugin workarounds: Harmor can import `.scl` files, Sytrus uses `.fnv` envelopes, and a Patcher-based approach requires 128 separate processing chains. The piano roll is permanently locked to 12 notes. **Pianoteq** deserves mention for its physically-modeled approach where retuning changes string tension and inharmonicity, producing the most acoustically authentic results among virtual instruments. **Surge XT** stands out as both a free, open-source synth with an integrated tuning editor and an **MTS-ESP source** that can control the tuning of all compatible plugins in a session.

For your DAW, the recommended UX combines Ableton's adaptive piano roll and global-scope tuning with Bitwig's per-track override capability. Ship a categorized preset library (Historical, EDO, Cultural, Artistic), support `.scl`/`.kbm` import natively, and include an in-app tuning editor that can also act as MTS-ESP master.

---

## MTS-ESP protocol and host implementation

MTS-ESP (created by ODDSound, in collaboration with Richard D. James) extends the original 1992 MIDI Tuning Standard from SysEx-over-MIDI to **shared memory via a dynamic library**. Where classic MTS achieves 0.0061-cent resolution through 14-bit SysEx encoding (`xx yy zz` = semitone + fractional MSB/LSB), MTS-ESP operates at **64-bit double-precision** with essentially zero latency.

The architecture is simple: a shared dynamic library (`libMTS.dll` / `libMTS.dylib` / `libMTS.so`) installed at a platform-specific path holds a global data structure containing **a boolean** (master online?), **an int** (client count), **one or sixteen 128-element `double` arrays** (frequency tables), a **scale name** string, and **note filter** arrays. One plugin registers as "master" and writes tuning data; all "client" plugins read it automatically with no user configuration. As Surge developer baconpaul summarizes: "MTS just shares a bool, an int, and either one or 16 128-double arrays between plugins. That's it."

The **Master API** (`libMTSMaster.h`) provides:

- `MTS_RegisterMaster()` / `MTS_DeregisterMaster()` — lifecycle management (only one master allowed)
- `MTS_SetNoteTunings(double *freqs)` — push all 128 frequencies at once
- `MTS_SetNoteTuning(double freq, char midinote)` — update a single note
- `MTS_SetScaleName(const char *name)` — metadata for client display
- `MTS_FilterNote(bool doFilter, char midinote)` — suppress unmapped keys
- `MTS_SetMultiChannelNoteTunings(double *freqs, char midichannel)` — 16-channel mode for controllers exceeding 128 keys

The **Client API** (`libMTSClient.h`) gives plugins `MTS_NoteToFrequency(client, midinote, midichannel)` which returns the absolute Hz value, `MTS_RetuningInSemitones()` for offset from 12-TET, and `MTS_ShouldFilterNote()` to check if a key is unmapped. Critically, clients should call these **continuously during audio processing**, not just at note-on — this enables real-time dynamic retuning of held notes.

**Implementation strategy for your DAW as MTS-ESP master:** Bundle or install `libMTS` at the platform path. On project load, call `MTS_RegisterMaster()`, populate the 128-entry frequency array from your tuning system, and call `MTS_SetNoteTunings()`. Whenever the user changes tuning (loading a Scala file, switching presets, editing the tuning table), update via `MTS_SetNoteTunings()` and `MTS_SetScaleName()`. On shutdown, call `MTS_DeregisterMaster()`. Check `MTS_HasIPC()` for process-sandboxed DAW configurations. Over **80 plugins** support MTS-ESP as clients, including Arturia's entire lineup, u-he (Diva, Zebra, Hive), Serum 2, FabFilter Twin 3, Pianoteq, and Surge XT.

---

## Surge XT's tuning engine as implementation reference

Surge XT's tuning system, built on the standalone `surge-synthesizer/tuning-library` (header-only C++, MIT-licensed), is the most battle-tested open-source reference. The library defines three core structures:

**`Tone`** stores each scale degree as `cents` (float), optional `ratio_n`/`ratio_d` (integers), and `floatValue = cents/1200.0 + 1.0` (a log2 frequency ratio where 2.0 = one octave). **`Scale`** holds the count of tones plus a vector of `Tone` objects parsed from an `.scl` file. **`KeyboardMapping`** stores the seven `.kbm` header fields (`count`, `firstMidi`, `lastMidi`, `middleNote`, `tuningConstantNote`, `tuningFrequency`, `octaveDegrees`) plus a per-key remapping vector where `-1` marks unmapped keys.

The **`Tuning`** class pre-computes a **512-entry lookup table** (covering MIDI notes −256 to +255 for modulation overshoot) with three parallel arrays: `ptable` (linear frequency ratio × MIDI_0_FREQ), `lptable` (log2 of the scaled frequency), and `scalepositiontable` (which scale degree each MIDI note maps to). The constant `MIDI_0_FREQ = 8.17579891564371` anchors the system. Tuning interpolation happens in **log2 space** for accuracy — a specific improvement noted in Surge's changelog.

Surge's `SurgeStorage` layer then copies these into audio-optimized `float table_pitch[512]`, `table_pitch_inv[512]` (precomputed reciprocals to avoid division), and `table_note_omega[2][512]` (precomputed `sin(2π·f·dt)` for filter cutoff tracking). All tuning calculations happen **at scale-load time**; runtime pitch lookups are simple array indexing.

Surge implements **two tuning application modes** that represent a fundamental design choice:

- **"Apply tuning at MIDI input"** (default): `table_pitch[]` uses 12-TET values; tuning only affects the initial MIDI-to-pitch conversion. Pitch bend always means ±N×100 cents regardless of scale. This is predictable and compatible with existing patches.
- **"Apply tuning after modulation"**: `table_pitch[]` carries the full custom tuning. A pitch bend of +2 means "two scale degrees up," which varies with the tuning. This is musically idiomatic for microtonal composition.

For MTS-ESP, Surge acts as both client (querying `MTS_NoteToFrequency()` per voice) and source (pushing `MTS_SetNoteFrequency()` for all 128 notes when its tuning editor changes). It supports dynamic microtuning where held notes track tuning changes in real-time, with an option to snapshot tuning at note-on only.

---

## Scala file parsing and frequency table generation

The `.scl` format is deceptively simple. Lines starting with `!` are comments. The first non-comment line is a description. The second is the note count N. The following N lines each define a pitch: **if the line contains a period, it's cents; otherwise it's a ratio** (e.g., `5/4` or bare `3` meaning 3/1). Degree 0 (unison, 1/1) is always implicit. The last entry is the **period** — typically `2/1` (1200.0 cents) for octave-repeating scales, but non-octave periods like `3/1` are valid.

Converting ratios to cents: **`cents = 1200 × log₂(ratio)`**. Converting cents to ratios: **`ratio = 2^(cents/1200)`**. The internal `floatValue` used by the Surge library is `cents/1200.0 + 1.0`, representing a log2 frequency offset where 2.0 means one period up.

The `.kbm` format has seven header values followed by a mapping table:

1. **Map size** (0 = linear identity mapping)
2. **First MIDI note** to retune (usually 0)
3. **Last MIDI note** to retune (usually 127)
4. **Middle note** — MIDI note where scale degree 0 starts (usually 60)
5. **Reference note** — MIDI note pinned to a fixed frequency (usually 69)
6. **Reference frequency** — Hz for the reference note (usually 440.0)
7. **Octave degree** — which scale degree constitutes the "formal octave" (0 = last degree)

Each subsequent line maps one key position to a scale degree, or `x` for unmapped. The pattern repeats cyclically.

**The algorithm to generate a 128-note frequency table** from `.scl` + `.kbm`:

1. Parse the `.scl` into an array of Tone objects with computed `floatValue` for each
2. Parse the `.kbm` header and mapping entries
3. Determine the tuning-center pitch offset: find what scale degree the reference note maps to and compute its `floatValue` offset
4. Compute `pitchMod = log₂(referenceFreq / MIDI_0_FREQ) - 1.0`
5. For each MIDI note 0–127: determine the mapping key position (cyclic modular arithmetic against `middleNote`), look up the scale degree from the `.kbm` mapping, compute the octave (number of complete periods), then:

```
pitch = tones[thisRound].floatValue
      + rounds × (tones[last].floatValue - 1.0)
      - tuningCenterPitchOffset

log2Freq = pitch + pitchMod
frequency = 2^log2Freq × MIDI_0_FREQ
```

For scales with more than 12 notes per octave (e.g., 31-EDO), the `.kbm` maps the 12 physical keys to selected degrees from the larger set. For scales with fewer (e.g., 7-note just intonation), unmapped keys get `-1` and can be interpolated via the library's `withSkippedNotesInterpolated()` method.

---

## The mathematics behind non-12-TET tuning

**Equal temperaments** divide the octave into N equal parts: `freq(step) = base × 2^(step/N)`, with each step spanning `1200/N` cents. The musical quality of a given N-TET depends on how well it approximates pure intervals — particularly the perfect fifth (3/2 = 701.955 cents) and major third (5/4 = 386.314 cents). Key systems: **19-TET** (63.16¢ steps, approximates 1/3-comma meantone with minor thirds within 0.2¢ of just), **31-TET** (38.71¢ steps, approximates quarter-comma meantone with major thirds within 1¢ of just), and **53-TET** (22.64¢ steps, fifths within 0.07¢ of just, used in Turkish music theory). These N values emerge from convergents of the continued fraction expansion of log₂(3/2).

**Just intonation** uses pure frequency ratios: the major scale is 1/1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2/1. Converting to a frequency table means simply multiplying each ratio by the base frequency. The fundamental problem is the **syntonic comma** (81/80 ≈ 21.5 cents): the D→A fifth in a just C major scale has ratio 40/27 ≈ 680.4 cents — **21.5 cents flat** of pure. No fixed 12-note just tuning provides pure fifths and pure thirds simultaneously for all keys.

**Pythagorean tuning** builds all intervals from chains of pure fifths (3/2). Twelve stacked pure fifths overshoot seven octaves by the **Pythagorean comma**: (3/2)¹² / 2⁷ = 531441/524288 ≈ 23.46 cents. One "wolf fifth" (≈678.5 cents) absorbs this error. The system has two semitone sizes: the limma (256/243 ≈ 90.22 cents) and the apotome (2187/2048 ≈ 113.69 cents).

**Quarter-comma meantone** solves the sharp Pythagorean major third (81/64 ≈ 407.8 cents) by narrowing each fifth by 1/4 of the syntonic comma. The tempered fifth equals **5^(1/4) ≈ 1.49535 ≈ 696.578 cents**, producing exactly just major thirds (5/4) after four stacked fifths. The tradeoff is a dramatic wolf fifth of ≈737.6 cents between G# and E♭. This was the dominant keyboard tuning from roughly 1500–1700 and is closely approximated by 31-EDO.

---

## Scale folding: remapping MIDI across key changes

When a user switches the project from C Major to D Dorian, existing MIDI clips need intelligent remapping that preserves musical intent. The algorithm operates in three phases: **decompose** each note into scale coordinates, **map** scale degrees between source and destination, and **reconstruct** the MIDI note.

**Phase 1 — Decomposition.** For a MIDI note `m` in source scale `S_src` (root `R_src`, pitch classes `PC_src`):

```
relativePitchClass = (m mod 12 - R_src + 12) mod 12
octave = floor((m - R_src) / 12)
```

If `relativePitchClass` matches a scale degree `d` in `PC_src`, the note is **in-scale** with `chromaticOffset = 0`. Otherwise, find the nearest lower degree `d_lower` and compute `chromaticOffset = relativePitchClass - PC_src[d_lower]`.

**Phase 2 — Degree mapping.** For scales with the same number of degrees (e.g., both 7-note), use direct 1:1 index mapping. For different-sized scales (e.g., major → pentatonic), map each source degree to the destination degree with the nearest chromatic pitch class.

For **in-scale notes**: `newRelativePC = PC_dst[mappedDegree]`. For **out-of-scale (chromatic) notes**, use proportional remapping that preserves the passing-tone character:

```
srcGap = PC_src[d_lower + 1] - PC_src[d_lower]
dstGap = PC_dst[mappedDegree + 1] - PC_dst[mappedDegree]
newChromaticOffset = round(chromaticOffset × dstGap / srcGap)
```

This ensures a chromatic passing tone between scale degrees 3 and 4 in C Major (the E-F gap, 1 semitone) correctly maps to the corresponding gap in D Dorian. When source and destination gaps are equal, offsets transfer directly. When the destination gap is smaller (e.g., narrowing from a whole step to a half step), the rounding naturally merges the chromatic note with the nearest scale degree — the only musically sensible outcome when there's no room for a passing tone.

**Phase 3 — Reconstruction:** `newMIDI = R_dst + (octave × 12) + newRelativePC`, clamped to 0–127.

**Concrete example — C Major → D Dorian:** C Major PC = [0,2,4,5,7,9,11], D Dorian PC = [0,2,3,5,7,9,10]. Degree 0 (C→D), degree 1 (D→E), degree 2 (E→F), degree 3 (F→G), degree 4 (G→A), degree 5 (A→B), degree 6 (B→C). A G# passing tone (between degrees 4 and 5, offset 1 in a gap of 2) maps to a passing tone between A and B in D Dorian (offset 1 in a gap of 2) — correctly landing on B♭.

**Non-destructive implementation:** Each clip stores a `sourceScale` (captured at creation). The project stores a `currentScale`. The fold is a **pure function** computed at display and playback time; original MIDI data is never modified. Changing back to the original scale produces the original notes exactly. A "bake" operation lets users commit the fold permanently. For microtuning/non-12-TET scales, replace `mod 12` with `mod stepsPerOctave` — the algorithm generalizes cleanly, as demonstrated by SuperCollider's layered pitch architecture.

---

## Lock-free Rust architecture for the tuning table

The tuning table must be readable by the audio thread on every sample block without ever blocking. The data is written infrequently (when the user changes tuning) and read hundreds of times per second. This is a textbook **single-producer, single-consumer, latest-value** pattern.

**The `triple_buffer` crate (v9.0)** is the recommended solution. It maintains three copies of the data: one for the producer, one for the consumer, and one shared back-buffer. When no update has occurred, the consumer read is **a single memory read with no atomic operation**. When data has been updated, it requires one infallible atomic swap — cheaper than any mutex. The consumer always sees the latest value with no queue backlog. RAM overhead for a tuning table is ~3 KB (3 × 1 KB for `[f64; 128]`), fitting comfortably in L1 cache.

Alternatives compared: **`ArcSwap`** supports multiple readers/writers via atomic `Arc` swapping (with `Cache` wrapper for near-zero-cost reads), suitable if multiple audio threads need the data. **`basedrop::SharedCell`** provides deferred deallocation for RT safety but is overkill for fixed-size data. **Raw `AtomicPtr`** offers maximum control but requires `unsafe` and manual deferred deallocation. **`SeqLock`** works for small, frequently-updated data but adds retry logic.

The recommended data structure:

```rust
#[derive(Clone, Copy)]
pub struct TuningTable {
    pub frequencies: [f64; 128],      // Hz per MIDI note
    pub log2_frequencies: [f64; 128], // log2(Hz) for pitch math
    pub reference_freq: f64,          // e.g., 440.0
    pub reference_note: u8,           // e.g., 69
}
```

Storing `log2_frequencies` alongside raw frequencies is critical: **pitch operations are inherently logarithmic**, and pre-computing avoids per-sample `log2()` calls. Linear interpolation in log2 space equals geometric interpolation in frequency space — the musically correct behavior. The entire struct at ~2 KB fits in L1 cache.

**Replacing the 12-TET formula** is a direct substitution. The old path `freq = 440.0 * 2.0_f64.powf((note - 69.0) / 12.0)` becomes `freq = table.frequencies[note as usize]`. For fractional MIDI notes (pitch bend, portamento), interpolate in log2 space:

```rust
fn freq_fractional(table: &TuningTable, note: f64) -> f64 {
    let idx = note.floor() as usize;
    let frac = note - idx as f64;
    let log2 = table.log2_frequencies[idx] * (1.0 - frac)
             + table.log2_frequencies[idx + 1] * frac;
    2.0_f64.powf(log2)
}
```

**Pitch bend** should support both modes following Surge XT's proven design. Mode A (default): bend in cents space via `base_freq * 2^(bend_semitones / 12.0)` — consistent and predictable across all tunings. Mode B: bend in scale-degree space by interpolating in the tuning table — musically idiomatic for microtonal work. Store the choice per-patch.

**Portamento** between notes with non-uniform intervals uses the same log2 interpolation: `log2_current = log2_from + (log2_to - log2_from) × progress`. This produces a perceptually constant-speed glide regardless of interval size.

**Tauri v2 integration pattern:** Create the `triple_buffer` at startup, move the `Output` half into the `AudioEngine`, and wrap the `Input` half in a `Mutex` inside Tauri's managed state. The `Mutex` is fine on the UI side — it only protects against concurrent Tauri command invocations and never touches the audio thread. Expose `set_tuning` as a Tauri command that computes the new `TuningTable` (from Scala files via the `tune` crate, or from EDO/JI formulas) and calls `input.write(table)`. The audio callback calls `output.read()` every block — lock-free and wait-free.

Key crates for the ecosystem: **`tune`** for generating tuning tables from Scala files and EDO specifications, **`rtrb`** for RT-safe MIDI message passing (separate from the tuning table), **`cpal`** for cross-platform audio I/O, and **`assert_no_alloc`** in debug builds to verify the audio callback never allocates.

---

## Bringing it all together

The complete architecture flows as follows: the React 19 frontend presents a tuning browser (categorized presets, `.scl`/`.kbm` import, in-app editor) and an adaptive piano roll that redraws row count per octave based on the active scale. User tuning changes invoke Tauri commands that parse Scala files into a `TuningTable` struct, write it through the triple buffer to the Rust audio engine, push it to third-party plugins via `MTS_SetNoteTunings()`, and trigger piano roll re-rendering via WebGPU. The audio engine's oscillators read `table.frequencies[note]` directly — no formula, no branching, no lock contention. Scale folding operates as a pure function over MIDI clips, storing original data immutably and computing remapped output on demand.

Three implementation insights stand out. First, **always work in log2 frequency space** for interpolation, portamento, and pitch math — the Surge team learned this the hard way and specifically patched it. Second, **implement both pitch-bend modes from day one** — the cents-space default satisfies performers, while the scale-degree mode satisfies microtonal composers, and the choice per-patch avoids forcing a compromise. Third, **MTS-ESP and your internal tuning table share the same data format** (128 doubles of Hz values), so your DAW's tuning system and its MTS-ESP master output are a single write path, not two parallel systems. This keeps the architecture simple and the tuning source-of-truth unambiguous.
