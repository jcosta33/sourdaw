---
type: research
id: RESEARCH-notation
title: Score notation from MIDI
status: open
owner: The Sourdaw team
sources:
  - "Question: how should a DAW render editable staff notation from MIDI without destroying timing?"
---

# Research: Score notation from MIDI

> Co-located research for `.agents/specs/notation/spec.md`. The summarized findings (R-001…R-005)
> below are the working research summary; the **Restored research evidence base** at the foot of this
> file preserves the original long-form findings (engine comparison, quantization algorithms,
> MusicXML pitfalls, Rust/TS boundary, market context) recovered from
> `research/features/notation.md` after a docs migration dropped them.

## Question

How should a DAW render editable staff notation from a MIDI source of truth without
destroying performance timing, which renderer to use, and how should interchange work?

## Findings

### R-001 — Non-destructive display quantization is mandatory

- **Claim:** Notation must quantize a *display* layer only; the played MIDI timing is never altered. A grid-based dynamic-programming quantizer maps onsets to the nearest notatable grid position while keeping the raw timing as the source.
- **Evidence:** Logic Pro's "Interpretation" display flag; MuseScore/Dorian quantization research; user complaints about destructive quantize in legacy DAWs.
- **Confidence:** high
- **Bears on:** AC-001 (MIDI source-of-truth invariant).

### R-002 — VexFlow v5 is the renderer

- **Claim:** VexFlow v5 (MIT-licensed, ESM) renders engraving-quality staves in the browser and supports incremental, measure-scoped re-layout.
- **Evidence:** VexFlow v5 release notes; flow.js / OSMD comparisons; SVG output integrates with React.
- **Confidence:** high
- **Bears on:** AC-002, AC-003.

### R-003 — Measure-level invalidation keeps editing responsive

- **Claim:** Re-engraving only the dirty measures (not the whole score) keeps a multi-page score editable at interactive latency.
- **Evidence:** OSMD/MuseScore layout-region patterns; profiling notes in the source.
- **Confidence:** medium
- **Bears on:** AC-003.

### R-004 — MusicXML 4.0 is the interchange format

- **Claim:** MusicXML 4.0 (W3C Community Group) is the universal interchange; partwise schema validation plus round-trip testing against Finale/Sibelius/MuseScore exports is the correctness bar.
- **Evidence:** MusicXML 4.0 spec; near-universal notation-app support.
- **Confidence:** high
- **Bears on:** AC-006, AC-007.

### R-005 — Beam grouping follows meter

- **Claim:** Beam grouping must follow the time signature's beat units (e.g. 6/8 groups in dotted-quarter beats), not a flat eighth-note run.
- **Evidence:** standard engraving rules (Gould, *Behind Bars*); VexFlow auto-beam config.
- **Confidence:** high
- **Bears on:** AC-008.

## Open questions

- [ ] Q-001 — DP quantizer cost-function weights (onset error vs notation complexity) need tuning against a human-transcription corpus.
- [ ] Q-002 — Tuplet detection threshold: when does the quantizer prefer a triplet over a dotted figure?
- [ ] Q-003 — How are multi-voice (polyphonic) measures split into VexFlow voices?

## Recommendation

Adopt a non-destructive grid-DP display quantizer over a MIDI source of truth (R-001),
render with VexFlow v5 (R-002) using measure-scoped invalidation (R-003), and standardise
interchange on validated MusicXML 4.0 with round-trip tests (R-004) and meter-aware beam
grouping (R-005). Tune the DP weights (Q-001/Q-002) against a transcription corpus before
shipping defaults.

---

# Restored research evidence base

The following sections are recovered verbatim (lightly trimmed to the dropped material) from
the original `research/features/notation.md` that the docs migration removed. They are the
detailed evidence behind the summarized R-001…R-005 findings above.

## RR-A — Rendering-engine comparison: VexFlow vs OSMD vs Verovio

After evaluating all three candidates — VexFlow, OpenSheetMusicDisplay (OSMD), and Verovio —
**VexFlow v5.0.0** (released March 2025) is the strongest fit for a React/TypeScript DAW with
real-time editing needs. The reasoning comes down to control granularity, performance
characteristics, and architectural alignment.

VexFlow operates at the measure level with an imperative API: you construct `Stave`,
`StaveNote`, `Voice`, and `Beam` objects, then call a `Formatter` and `draw()`. This
granularity is exactly what a DAW notation view needs, because **you can re-render individual
measures** when a user drags a MIDI note rather than rebuilding the entire score. VexFlow v5
is written in TypeScript (75.7% of the codebase), ships its own type definitions, and is
MIT-licensed. Bundle size is **~300–500 KB** with a single font, and the new
`@vexflow-fonts/*` package architecture supports lazy-loading. The project has **4,300 stars**
(legacy repo) with active maintenance by 2–3 core contributors, and v5 introduced pointer
events and improved bounding boxes — both critical for interactive use.

| Criterion                   | VexFlow v5                           | OSMD 1.8.9               | Verovio 6.1.1      |
| --------------------------- | ------------------------------------ | ------------------------ | ------------------ |
| Rendering granularity       | Measure-level                        | Full score               | Page-level         |
| Re-render cost (8 measures) | **<5ms**                             | ~400ms                   | ~50ms              |
| Bundle size                 | ~400 KB                              | ~1 MB                    | ~10 MB WASM        |
| TypeScript                  | Native                               | Native                   | @types (community) |
| License                     | **MIT**                              | BSD-3                    | LGPL v3            |
| React integration           | Manual (useRef + useEffect)          | Semi-official wrapper    | Manual + WASM init |
| MusicXML parsing            | None                                 | Native                   | Native (via MEI)   |
| Interactive features        | Bounding boxes + pointer events (v5) | None                     | Limited edit() API |
| Engraving quality           | Good                                 | Good (VexFlow-dependent) | Excellent          |

**Recommendation**: Use VexFlow v5 as your rendering engine. Build a thin React wrapper using
`useRef`/`useEffect` that manages VexFlow's lifecycle. Implement viewport-based rendering (only
render measures visible in the scrollable area) and measure-level cache invalidation. When a
MIDI note changes, recompute and re-render only the affected measure(s). If engraving quality
becomes a product priority later, Verovio can be introduced as an alternative backend behind
the same abstraction layer — or even compiled natively and called from Rust via Tauri commands
for high-quality PDF export.

## RR-B — Why Verovio is rejected for phase 1 (kept as a future PDF backend)

Verovio deserves serious consideration for one specific reason: its page-based rendering model
means you can re-render a single page without touching the rest of the score, and its C++/WASM
engine achieves sub-100ms page renders. The engraving quality is professionally superior to
VexFlow. However, the trade-offs are significant: **~10 MB WASM binary** (less concerning in
Tauri than a web app, but still substantial), **LGPL v3 licensing** (requires distributing
modifications to Verovio itself as open source), SVG-string output that doesn't integrate
cleanly with React (requires `dangerouslySetInnerHTML`), and community-maintained TypeScript
types that may lag behind releases. Verovio's architecture is MEI-centric — MusicXML is
converted to MEI internally — adding a format translation layer you don't need.

**Verovio as a Rust-native renderer** is an intriguing option for a later phase. Since Verovio
is C++, it could be compiled as a native library and linked into your Rust backend via FFI,
bypassing WASM entirely. This would enable server-side or backend rendering for PDF export at
professional engraving quality — a compelling feature for users who want to print parts. The
LGPL license permits this as long as Verovio remains a dynamically-linked library.

## RR-C — Why OSMD is "a trap" for this use case

OSMD sits on top of VexFlow and adds native MusicXML parsing, but it's a trap for this use
case. It renders the entire score on every update — **~400ms for a medium Beethoven sonata,
2–8 seconds for large scores** — making it unusable for real-time note editing. OSMD's own
documentation states it is "a renderer, not an interactive sheet music editor." Since your
pipeline goes MIDI → display quantization → VexFlow objects (not MIDI → MusicXML → OSMD →
VexFlow), OSMD's MusicXML parsing adds no value while imposing its performance ceiling. Its
**~1 MB** bundle also doubles VexFlow's footprint for no gain.

## RR-D — React integration pattern for VexFlow

Since VexFlow operates outside React's virtual DOM, the integration pattern is straightforward
but requires discipline:

```typescript
const NotationView: React.FC<{ measures: DisplayMeasure[] }> = ({ measures }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VexFlow.Renderer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Initialize once, clear and re-render on data changes
    containerRef.current.innerHTML = '';
    const renderer = new VexFlow.Renderer(containerRef.current, VexFlow.Renderer.Backends.SVG);
    rendererRef.current = renderer;

    // Only render visible measures (virtualization)
    const visibleMeasures = getVisibleMeasures(measures, scrollPosition, viewportWidth);
    visibleMeasures.forEach(m => renderMeasure(renderer.getContext(), m));
  }, [measures]);

  return <div ref={containerRef} />;
};
```

Use SVG rendering (not Canvas) for better interactivity — each note becomes an SVG element with
a bounding box for hit-testing. Debounce re-renders during drag operations to maintain 60fps.

## RR-E — Display quantization: grid, dynamic programming, and Bayesian/HMM

Raw MIDI data from a piano roll — even when step-entered — maps poorly to readable notation
because tick positions and durations don't align to clean note values. A note starting at tick
479 with a duration of 481 ticks renders as a bizarre tied 128th-note construction instead of a
clean quarter note. **Display quantization** is the non-destructive transformation that produces
readable notation while preserving the original MIDI data for playback. This is the hardest
engineering problem in the entire notation view.

### Grid-based snapping: the pragmatic baseline

The simplest approach snaps each note onset and offset to the nearest position on a time grid.
Given a grid resolution `g` (in ticks), each onset becomes `round(onset / g) * g`. Typical grid
resolutions at 480 TPQ: quarter = 480, eighth = 240, sixteenth = 120, eighth triplet = 160,
sixteenth triplet = 80.

```
function gridQuantize(notes, ticksPerBeat, gridDivision):
    gridSize = ticksPerBeat / gridDivision
    for each note in notes:
        note.displayOnset = round(note.onset / gridSize) * gridSize
        note.displayDuration = round(note.duration / gridSize) * gridSize
        note.displayDuration = max(note.displayDuration, gridSize)  // minimum duration
    return notes
```

This is what most DAWs implement. **MuseScore's MIDI import** uses an adaptive variant: it
analyzes the shortest inter-onset interval per measure to select the grid resolution
automatically, and lets users override with a "maximum quantization value" setting. The
limitation is that grid-based snapping treats each note independently — it can't preserve the
rhythmic relationships between notes (e.g., a swing pattern of alternating long-short eighths
gets flattened to equal eighths or mangled into dotted-sixteenth/thirty-second pairs depending
on grid resolution).

### Dynamic programming: balancing accuracy against readability

The DP approach formulates quantization as an optimization problem. Define a cost function that
penalizes both timing deviation (accuracy) and notational complexity:

```
TotalCost = α × Σ(t_i - g(c_i))² + (1-α) × Σ w(c_i)
```

where `t_i` is the observed onset, `g(c_i)` is the grid position assigned to note `i`, `w(c_i)`
is a complexity weight (**whole=1, half=2, quarter=4, eighth=8, sixteenth=16** — simpler
durations are cheaper), and α balances the two objectives. The recurrence:

```
V(n, g) = min over g_prev [ V(n-1, g_prev) + accuracy(n, g) + transition(g_prev, g) ]
```

Backtracking through the DP table yields the globally optimal assignment. The transition cost
penalizes musically implausible duration sequences (e.g., a 64th note followed by a whole
note). Complexity is O(N × G²) where N is note count and G is grid positions per measure —
tractable for real-time use with typical scores.

### Bayesian and HMM-based models: the state of the art

The most accurate approach, developed by Cemgil, Desain, and Kappen (2000) and extended by
Nakamura et al. (2017), treats quantization as probabilistic inference. The **metrical HMM**
models hidden states as (beat position, local tempo) pairs with Gaussian emission probabilities
for observed onset times:

```
P(t_n | s_n, τ_n) = N(t_n; T(s_n, τ_n), σ²)
```

Transition probabilities between beat positions are learned from a score corpus. **Viterbi
decoding** simultaneously estimates beat positions, bar lines, meter, and tempo — handling
rubato naturally by allowing the tempo state to evolve as a Gaussian random walk. Nakamura's
evaluation showed this approach **significantly outperforms MuseScore and Finale** on real
piano performances. However, it requires a trained model and is computationally heavier than
grid-based approaches.

## RR-F — Recommended quantization pipeline (swing, rests, ties, beams)

For a DAW notation view, implement a **tiered approach** — grid-based quantization for the
initial release, with DP enhancement in a second phase:

```
Pipeline: Raw MIDI → Display Notation (non-destructive)

1. BUILD BEAT GRID from tempo map + time signatures (trivial for DAW data)
2. DETECT TUPLETS per beat window:
   - For each beat, test triplet/quintuplet grids vs straight grid
   - Score = Σ min(offset_to_nearest_grid_point)²
   - Mark as tuplet if tuplet_error < straight_error × 0.6
3. DETECT SWING:
   - Collect on-beat/off-beat eighth pairs, compute mean duration ratio
   - If ratio ∈ [1.8, 2.5] with σ < 0.3: flag as swing, display straight eighths
4. SNAP ONSETS to grid (straight or tuplet as detected)
5. SNAP DURATIONS: offset = max(quantized_offset, onset + min_grid)
6. VOICE SEPARATION:
   - Piano: split at pitch threshold (MIDI 60 = middle C)
   - Single-line: greedy assignment minimizing pitch leap cost
7. REST INSERTION following beat-boundary rules:
   - Never span the mid-bar boundary in 4/4
   - Complete current beat before using larger rest values
   - Use half rests only on strong beats (1 or 3 in 4/4)
8. TIE INSERTION: split notes at bar lines and required beat boundaries
9. BEAM GROUPING per time signature rules:
   - Simple meters: beam within beats (groups of 2 eighths)
   - Compound meters: beam within dotted-quarter beats (groups of 3)
   - In 4/4: NEVER beam across beats 2-3
10. DURATION DECOMPOSITION: convert tick durations to notation-legal values
    - Greedily subtract largest legal duration fitting within beat structure
    - Tie together if multiple notes needed
```

**Beam grouping pseudocode** (the most commonly requested detail):

```
function assignBeamGroups(notes, timeSig, ticksPerBeat):
    if isCompound(timeSig):
        beatUnit = ticksPerBeat * 3  // dotted quarter
    else:
        beatUnit = ticksPerBeat

    // In 4/4, strong boundary at mid-bar (beat 3)
    strongBoundaries = getStrongBoundaries(timeSig, ticksPerBeat)

    currentGroup = []
    for each note in notes:
        if note.duration >= ticksPerBeat:  // quarter or longer: no beam
            flush(currentGroup); currentGroup = []
            continue
        beatOfNote = floor(note.onset / beatUnit)
        if currentGroup is not empty:
            beatOfPrev = floor(currentGroup.last.onset / beatUnit)
            if beatOfNote != beatOfPrev or crossesStrongBoundary(note, strongBoundaries):
                flush(currentGroup); currentGroup = []
        currentGroup.append(note)
    flush(currentGroup)
```

**Rest insertion rules** (critical for readable notation):

In 4/4 with a gap from beat 1.5 to beat 4.0, the correct rest sequence is: eighth rest (finish
beat 1) + quarter rest (beat 2) + quarter rest (beat 3). It is _not_ a dotted half rest — that
would hide the beat structure. The rule is: **rests must make beat boundaries visible**, and you
must never use a single rest that spans a strong metric boundary.

## RR-G — MusicXML generation pitfalls

MusicXML 4.0 is the interchange format supported by **270+ applications** including Dorico,
MuseScore, and Sibelius. Generating valid MusicXML from your DAW's internal state is primarily a
data transformation problem — verbose XML, but conceptually straightforward once you've already
solved display quantization.

The critical concept is the `<divisions>` element, which defines how many tick units equal one
quarter note in the XML file. **Set divisions equal to your DAW's PPQ** (e.g., 480) and duration
values map directly to tick durations — no conversion math needed. Alternatively, use
**divisions=24** for cleaner files: this handles both triplets (divisible by 3→8 per triplet
eighth) and regular subdivisions (divisible by 4→6 per sixteenth).

**The hardest pitfalls** are voice encoding and tied notes. MusicXML encodes multiple voices
sequentially within a measure using `<backup>` elements to rewind the time cursor between
voices. Voice numbers must be **unique across staves** in a multi-staff part — Dorico interprets
reused voice numbers across staves as the same voice, creating unwanted chord collisions. Use
voices 1–2 for staff 1, voices 3–4 for staff 2.

For tied notes across barlines, both `<tie type="start"/>` (sound element) and
`<tied type="start"/>` (notation element inside `<notations>`) are required. Missing either
causes rendering failures in different programs. Always include `<type>` alongside `<duration>`
on every note — Finale deduces note type from duration if `<type>` is missing, while MuseScore
prioritizes `<type>`, and the two can produce different results.

**No existing JS/TS library handles MIDI-to-MusicXML conversion.** The available packages are
either parsers/renderers (OSMD), have problematic licenses (`musicxml-interfaces` is AGPL), or
are unstable (`@stringsync/musicxml` is marked "use at your own risk"). For the XML generation
layer itself, **string template literals** are the simplest approach for a first implementation.
Test imports with MuseScore first — it has the most forgiving and informative MusicXML importer.

## RR-H — Minimum viable feature set (user-facing controls)

Cubase 14's Dorico-powered Score Editor has reset market expectations. The minimum viable
feature set, based on user expectations and competitor analysis:

- **Display quantization** separating visual representation from MIDI playback (non-negotiable)
- Treble and bass clefs with key and time signatures (including changes)
- **Automatic beaming** based on meter — the most basic readability requirement
- Multi-voice display (at least 2 voices per staff) with correct stem direction
- Grand staff for piano/keyboard instruments
- Ties, rests, accidentals, dots
- Basic dynamics (pp through ff), hairpins, staccato, accent, tenuto
- Transposing instrument display
- Tuplet display (at minimum triplets)
- Scrolling/continuous view mode
- Print/PDF export

Chord symbols, lyrics, guitar tablature, MusicXML export, and page layout controls are expected
in a competitive product but can ship in a second phase. Professional engraving, score-driven
playback (dynamics affecting MIDI velocity), cross-staff beaming, and advanced page layout are
legitimately left to dedicated notation software — and MusicXML export becomes the bridge to
that workflow.

## RR-I — Rust / Tauri architecture for quantization

**Display quantization should run in Rust** if you implement anything beyond basic grid
snapping. The DP approach has O(N × G²) complexity per measure, and the HMM approach involves
Viterbi decoding over a state space of ~48 beat positions × tempo states. For a 200-measure
score with tempo changes, the Rust performance advantage (no GC pauses, SIMD, native threading)
matters. More importantly, quantization is a pure data transformation with no DOM dependencies —
it takes MIDI notes in and produces quantized note descriptors out. This maps perfectly to a
Tauri command:

```rust
#[tauri::command]
fn quantize_for_display(
    notes: Vec<MidiNote>,
    time_signatures: Vec<TimeSigEvent>,
    tempo_map: Vec<TempoEvent>,
    options: QuantizationOptions,
) -> Vec<DisplayNote> {
    // Grid-based or DP quantization
    // Voice separation
    // Rest insertion
    // Beam grouping
    // Return display-ready note descriptors
}
```

The TypeScript frontend then takes these `DisplayNote` descriptors and maps them to VexFlow
objects for rendering. **MusicXML generation can live in either layer** but TypeScript is fine —
it's string manipulation, not compute-intensive work. A typical score serializes to XML in under
100ms regardless of language. Keep it in TypeScript unless you want a unified Rust pipeline.

## RR-J — Market context: what users expect from a DAW notation view

Cubase 14's Dorico-powered Score Editor has reset market expectations. Before it, DAW notation
editors were widely considered afterthoughts — Logic Pro's Score Editor hasn't been meaningfully
updated in years, and Studio One's Notion integration requires a separate application for
advanced features. The **number-one user complaint** across VI-Control, Gearspace, and Reddit is
poor MIDI-to-notation interpretation: live performances produce unreadable notation without
extensive manual cleanup. Enharmonic spelling errors rank second — DAWs don't choose between G#
and Ab based on harmonic context. Third is the confusing disconnect between display quantization
and actual MIDI playback data.
