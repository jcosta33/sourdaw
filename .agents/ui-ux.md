# Building a world-class DAW: complete UI/UX implementation guide

**The gap between a toy music app and a professional DAW lives almost entirely in the UI.** After exhaustive research across Bitwig Studio, Ableton Live, FL Studio, Logic Pro, and Reaper, this guide catalogs every major visual and workflow feature that defines industry-leading DAWs, ranks them by implementation impact and complexity, and provides concrete technical guidance for building each one in a React/TypeScript/WebGPU/Tauri stack.

The single most important finding: **three features generate disproportionate user love** — FL Studio's piano roll (universally called the best MIDI editor ever made), Bitwig's modulation halo system (the #1 reason users switch to Bitwig), and Ableton's Session View (the feature that launched a $750M company). Nail these three paradigms and the DAW immediately enters serious territory.

---

## Part 1: What users love most, by DAW

### Bitwig Studio — modulation visualization is king

Bitwig's unified modulation system is the most praised DAW feature in modern production forums. Every device parameter displays a **colored halo ring** showing modulation range in real-time. Blue halos = monophonic modulation; green halos = polyphonic per-voice. Users can attach **43+ modulator types** (LFOs, envelopes, step sequencers, MSEGs, audio sidechains) to any parameter including third-party plugins, with unlimited modulators per device operating at audio rate.

Visual feedback: entering routing mode turns available parameters blue/green; click-drag sets depth and direction; the resulting halo arc shows the sweep range. One KVR user: "I can do 10× as much in 10× less time than I could in Logic via automation." MusicRadar: "the ultimate destination for sound design and expressive modulation."

**The Grid** — 231+ modules, color-coded patch cables (orange=audio, turquoise=control, purple=phase, yellow=trigger), per-module oscilloscope in inspector, smart patching auto-connects.

**Nested device chains** — any device can house other devices: multiband processing, parallel routing, mid/side, feedback loops through a visual nesting metaphor.

**Note expression in piano roll** — per-note editing for velocity, pressure, timbre, gain, pan, micro-pitch shown as thin horizontal curves across note centers. Moves with the note on copy.

**Session + Arrangement side-by-side** — unlike Ableton which requires tab-switching, both views are simultaneously visible.

### Ableton Live — Session View defined a genre

**Session View** is a vertical grid of clip slots organized into tracks (columns) and scenes (rows). Each cell holds one clip triggerable independently or as an entire scene. Jam in Session View, engage Arrangement Record, and clip launches paint into the timeline in real-time.

**Warping** uses yellow inverted-triangle markers as anchor points — audio between markers stretches/compresses to fit the beat grid. Six warp modes. Auto-Warp analyzes long samples automatically.

**Instrument/Effect Racks** — Chain Selector horizontal ruler with colored zone bars, Key Zones mini keyboard per chain, up to 16 Macro knobs (Live 12) with Macro Variations for snapshot positions.

### FL Studio — the piano roll every other DAW envies

Universally acknowledged as the best MIDI editor across KVR, Gearspace, VI-Control, Reddit, and Ableton's own forums. Core philosophy: left-click to draw, right-click to delete, zero tool-switching.

Key differentiators:

- **Ghost notes** (Alt+V): Semi-transparent notes from all other channels behind the active channel. Double-click switches editing to that channel.
- **Chord stamps**: One-click placement of 15+ chord types. Chords stay grouped as a unit.
- **Magic Lasso**: Freeform shape selection by drawing around notes — unique to FL.
- **Strum tool** (Alt+S): Natural strum timing offset added to chord selections.
- **Adaptive "Line" snap**: Grid resolution auto-adjusts with zoom level.
- **Scale highlighting**: In-key rows highlighted, snap-to-scale available.
- **Paint tool**: Drag to fill repeated evenly-spaced notes instantly.

### Logic Pro — value and polish

**Smart Tempo**: Analyzes recordings, detects beats as orange markers with confidence colors. Record without a click track, Logic builds the tempo map. Industry-leading for tempo flexibility.

**Quick Swipe Comping**: Record in cycle mode, takes stack in lanes, swipe across desired sections to promote to composite. Pioneered the modern comping workflow.

**ChromaVerb** with animated chromatic spectrum decay display — the reverb is both functional and visually striking.

### Reaper — customization without limits

**Routing matrix** (Alt+R): Spreadsheet-style grid, rows=sources, columns=destinations, click intersections to create sends. Called "Reaper's secret superpower" — unlimited sends, up to 128 channels per track.

**Spectral view on waveforms**: Five display modes including full spectrogram overlay and spectral peaks (waveform colored by frequency content). Spectral editing for iZotope RX-style in-timeline work.

**Mouse modifier system**: Customize what every mouse action + modifier key does across ~20 contexts. Users can replicate any other DAW's mouse behavior.

---

## Part 2: The visualization features that generate the most praise

### Spectrum analyzer — FabFilter Pro-Q is the gold standard

Real-time FFT with configurable resolution (1024–8192 point), **4.5 dB/oct perceptual tilt**, adjustable release speed, GPU-accelerated at 60fps. Innovations: **Spectrum Grab** (hover to freeze, drag peaks to create EQ bands), **collision detection** (red glow shows masking between instances), **Spectral Dynamics** (triggers on specific frequencies).

**Implementation**: WebGPU. Upload FFT data as Float32Array to GPU storage buffer each frame via `device.queue.writeBuffer()`. Render as instanced quads or filled polygon. Apply perceptual tilt in shader. 2048-point FFT from `AnalyserNode.getFloatFrequencyData()` at 30–60fps.

### Spectrogram (waterfall)

Frequency on Y-axis, time on X-axis, amplitude as heatmap color. iZotope RX gold standard — waveform + spectrogram overlay, zoom, scroll, heat-map coloring (cool blues=quiet, warm reds=loud).

**Implementation**: WebGPU texture approach. Maintain a 2D storage texture, shift old data left by one column per frame via compute shader (`textureStore()` in WGSL), write new FFT column to rightmost position. Heatmap color function in shader. **60fps** for smooth scrolling.

### Stereo goniometer / Lissajous

L+R channels connected to X and Y of a virtual oscilloscope, rotated 45°. Mono=vertical line, stereo spreads horizontally, out-of-phase extends beyond ±45° diagonals. Phosphor glow decay effect.

**Implementation**: Canvas2D. Sample L/R from AudioWorklet, plot `(L+R, L-R)` coordinates with slowly decaying alpha. Draw semi-transparent black rectangle before new points. **30fps**.

### LUFS / loudness metering (EBU R128)

Three time scales: Momentary (400ms), Short-term (3s), Integrated (full with dual gating). Target -14 LUFS for streaming. K-weighting two-stage filter (shelving + high-pass). True peak meter. Loudness history graph.

**Implementation**: K-weighting filter in AudioWorklet. Gating algorithm: absolute threshold -70 LUFS, relative gate 10 LU below integrated. Canvas2D bar + history plot at 10fps.

### Modulation halos

Colored arcs around knobs showing modulation range. Real-time animation showing current value. Color-coded by source. Vital synth's **live preview** — hovering over a target auditions modulation before committing.

**Implementation**: CSS `conic-gradient` with `--mod-amount` custom property updated from JS at 30fps:

```css
.knob-halo {
    background: conic-gradient(from 225deg, transparent 0%, #00ff88 var(--mod-amount), transparent var(--mod-amount));
    border-radius: 50%;
}
```

GPU-composited by browser — essentially free to render.

### VU meters with ballistics

**300ms rise time** to 99% full-scale, 1–1.5% overshoot, 300ms fall. The slow ballistics correlate with perceived loudness. Color: green/amber scale, red above 0 VU. Peak hold overlay.

**Implementation**: Exponential smoothing per frame: `displayValue += (targetValue - displayValue) * (1 - exp(-dt / 0.3))`. Canvas2D bar at **30fps**. Peak hold: `max(currentPeak, previousPeak * decay)`.

---

## Part 3: Piano roll — the feature that makes or breaks a DAW

### Must-have features

**Ghost notes** from other tracks: semi-transparent overlays at 20–30% opacity. Double-click to switch editing channel. Shared horizontal scroll/zoom.

**Velocity lane**: Vertical bars colored by gradient (warm=loud, cool=soft). Click-drag across bars to draw velocity curves. Resizable divider between note grid and lane.

**Scale highlighting**: Root + scale type selector. Dim non-scale rows. "Automatic" mode detecting scale from existing notes.

**Note coloring**: By velocity (warm-to-cool gradient), pitch class (12 distinct hues), or MIDI channel.

**Selection tools**: Draw, Paint, Select (region + Magic Lasso freeform), Delete, Slice, Zoom.

**Quantize**: Grid value (1/4–1/64), strength (0–100%), swing amount, humanize/randomize.

### Differentiating features

**Per-note expression (MPE)**: Per-note pitch bend, pressure, timbre, slide as editable curves attached to individual notes. All expression data moves with the note when copied.

**Chord stamps**: Library of chord types (major, minor, dim, aug, 7ths, 9ths, sus, add). Place as grouped note blocks. Strum tool for natural timing offset.

**Groove extraction**: Select MIDI/audio clip, extract timing template, apply to other clips with adjustable strength.

**Step recording**: Select note value, play from MIDI keyboard, cursor auto-advances. Support dots, ties, rests, chord input.

**Implementation**: Canvas2D `fillRect()` for note blocks — extremely fast. Spatial indexing (interval tree) to only draw notes intersecting visible viewport. Layer order: grid lines (cached Path2D) → ghost notes → active notes → selection overlay → cursor.

---

## Part 4: Arrangement view

### Waveform rendering

Use **mipmap approach**: pre-compute min/max peak pairs at multiple samples-per-pixel ratios on load. Select level matching current zoom for instant rendering. Memory overhead = 2× original (geometric series).

Render technique: per pixel column, draw vertical line from min to max peak. Overlay RMS as thicker inner fill. Reaper's spectral peaks mode colors the waveform by frequency content (spectral centroid → warm-to-cool color).

Reference packages: **peaks.js** (BBC, production-grade), **wavesurfer.js v7** (TypeScript, Canvas, plugin ecosystem), **webgpu-waveform** (GPU shader-based).

### Clip interactions

**Fade handles**: Draggable squares at clip upper corners, visible on hover. Drag horizontally for length; curve handle for shape (linear, exponential, S-curve). Auto-crossfade when clips overlap.

**Clip gain handle**: Horizontal line across top of clip. Drag up/down adjusts gain; waveform rescales in real-time. Pre-insert operation (critical for consistent compressor feed).

**Clip gain envelopes**: Node-based automation embedded within clips that moves when clips move. Pro Tools gold standard implementation.

### Snap modes

FL Studio's adaptive "Line" snap (resolution auto-adjusts with zoom) is the most praised. Also: Bar, Beat, subdivisions (1/4–1/64), Triplet, Events (snap to other note start/end), Markers, Free.

### Ripple editing

Reaper's implementation: toggle Alt+P, per-track or all-tracks modes. Delete/insert/move automatically shifts subsequent content. Ableton's lack of ripple editing is one of its most cited failures.

### Comping / take lanes

Loop recording creates stacked take lanes within one track. Click-drag (swipe) across lanes to select best sections — auto-crossfade at splice points. Color-code each take. Logic Pro's Quick Swipe Comping is simplest; Bitwig's clip-based comping is portable.

---

## Part 5: Mixer and signal flow

### Channel strip anatomy (top to bottom)

Input gain trim → High-pass filter → EQ section → Dynamics → Aux/Send knobs → Pan → Mute/Solo/Record → **Fader** (min 150–200px travel) → Peak/RMS meter (adjacent to fader) → Channel name/color label.

Fader = largest element. Send knobs = compact 24–32px. Solo=yellow, Mute=amber, Record=red. Color bar at top = track color.

### Routing matrix

Reaper-style grid: rows=tracks, columns=destinations. Click intersections to create/remove sends. Hover reveals pan, volume, pre/post settings. SVG for connection indicators.

### VCA fader groups

VCA faders control gain of assigned channels **without audio passing through** — maintain relative positions, correctly scale post-fader sends. No meters on VCA strips. Store VCA associations; apply gain multiplier before each channel's post-fader sends.

### Mixer snapshots

Serialize entire mixer state to JSON. Up to 10 snapshots per project with instant recall. Selective recall (only EQ, only sends, only specific channels). Visual diff between snapshots.

---

## Part 6: Professional workflow features

**Non-destructive undo**: Command pattern with action serialization. Store as state diffs, not full snapshots. Scrollable history list with action descriptions.

**Multiple automation lanes per track**: Each parameter = its own collapsible sub-lane. Color-coded envelope lines. R/W/T/L modes.

**Group/folder tracks**: Expand/collapse tree. Organizational mode (no audio routing) vs bus mode (sum child audio through parent).

**Track freeze/bounce**: Render via `OfflineAudioContext`. Semi-transparent striped overlay on frozen tracks. Partial freeze (individual plugins).

**MIDI Learn**: WebMIDI API `navigator.requestMIDIAccess()`. Global learn mode with visual overlay. Store mappings as `{ cc, channel, min, max, parameterPath }`.

**Markers and arrangement sections**: Labeled, color-coded markers. Draggable/resizable arrangement sections (Intro, Verse, Chorus, Bridge, Outro). Click to jump.

---

## Part 7: The community wishlist

The top 10 features users are begging existing DAWs to add — a new DAW that ships all of these day one has a compelling pitch:

1. **FL Studio-quality piano roll** in every DAW — the #1 cross-DAW envy item
2. **Bitwig-style modulation** — modulate anything with anything, visual halos
3. **Session View + Arrangement side-by-side** — Bitwig does this; Ableton can't
4. **Better CPU multi-threading** — Reaper benchmarks as most efficient
5. **Plugin sandboxing** — Bitwig crash-isolates plugins; "when a VST crashes, it doesn't take down my DAW"
6. **AI stem separation** — now in Logic Pro 11 and Ableton 12.2; table stakes
7. **Non-destructive spectral editing built into the DAW** — not a separate app
8. **Real-time cloud collaboration** — "Google Docs for music producers"
9. **Cross-platform including Linux** — only Reaper and Bitwig do this
10. **Built-in LUFS metering** — most users rely on third-party plugins

---

## Part 8: Technology decisions per feature

| Feature           | Technology              | Update Rate    |
| ----------------- | ----------------------- | -------------- |
| Waveform display  | Canvas2D + mipmap       | On scroll/zoom |
| Spectrum analyzer | **WebGPU**              | 30–60fps       |
| Spectrogram       | **WebGPU compute**      | 60fps          |
| Oscilloscope      | Canvas2D                | 60fps          |
| Piano roll        | Canvas2D `fillRect`     | On edit/scroll |
| Automation curves | Canvas2D Path2D         | On edit        |
| Knob rotation     | CSS transform           | On input       |
| Modulation halos  | CSS conic-gradient      | 30fps          |
| Mixer faders      | HTML/CSS                | On input       |
| VU/peak meters    | Canvas2D                | 30fps          |
| LUFS meter        | Canvas2D + AudioWorklet | 10fps          |
| Track list        | React + virtual scroll  | On scroll      |
| Goniometer        | Canvas2D                | 30fps          |
| Routing matrix    | HTML grid + SVG         | On interact    |
| Compressor GR viz | Canvas2D                | 30fps          |
| Wavetable 3D      | WebGPU                  | 60fps          |

### Thread architecture

```
Main Thread (React)         < 5% CPU target
  - UI controls, layout, state mgmt
  - CSS-based animations (halos, knobs)

Audio Thread (AudioWorklet) Real-time priority
  - DSP via WASM/Faust
  - Writes to SharedArrayBuffer

Viz Worker 1 (Spectrogram)  Dedicated
  - Reads SAB via Atomics
  - FFT (Wasm SIMD)
  - Renders via OffscreenCanvas/WebGPU

Viz Worker 2 (Meters)       Dedicated
  - Peak/RMS/LUFS computation
  - Renders via OffscreenCanvas

Rust/Tauri Backend          Native
  - File I/O (symphonia codecs)
  - Waveform mipmap pre-computation
  - Project save/load (serde + JSON)
  - Audio I/O via cpal
```

### Key npm packages

- **wavesurfer.js v7** — production waveform visualization
- **peaks.js** (BBC) — pre-computed waveforms with zoom/overview
- **audioMotion-analyzer** — 240-band spectrum at 60fps, zero dependencies
- **@grame/faustwasm** — Faust DSP to WASM compiler pipeline
- **react-window** — virtual scrolling for large track lists
- **Comlink** — simplified Web Worker RPC
- **standardized-audio-context** — cross-browser Web Audio compatibility

---

## Part 9: Complete prioritized feature table

### Tier 1 — Foundation (build first)

| #   | Feature                              | Complexity | Visual Impact | Tech                   |
| --- | ------------------------------------ | ---------- | ------------- | ---------------------- |
| 1   | **Piano roll with ghost notes**      | High       | ⭐⭐⭐⭐⭐    | Canvas2D               |
| 2   | **Arrangement timeline + waveforms** | High       | ⭐⭐⭐⭐⭐    | Canvas2D + mipmap      |
| 3   | **Mixer channel strips**             | Medium     | ⭐⭐⭐⭐      | HTML/CSS/React         |
| 4   | **Transport + timeline ruler**       | Medium     | ⭐⭐⭐⭐      | Canvas2D               |
| 5   | **Track list with folders**          | Medium     | ⭐⭐⭐⭐      | React + virtual scroll |
| 6   | **Basic peak meters**                | Low        | ⭐⭐⭐        | CSS/Canvas2D           |
| 7   | **Session/clip launcher view**       | High       | ⭐⭐⭐⭐⭐    | React grid + Canvas    |
| 8   | **Plugin slot management**           | Medium     | ⭐⭐⭐        | React                  |

### Tier 2 — Professional polish

| #   | Feature                       | Complexity | Visual Impact | Tech                       |
| --- | ----------------------------- | ---------- | ------------- | -------------------------- |
| 9   | **Automation lanes**          | High       | ⭐⭐⭐⭐      | Canvas2D Path2D            |
| 10  | **Clip fade handles**         | Medium     | ⭐⭐⭐⭐      | Canvas2D + drag            |
| 11  | **Clip gain handle**          | Low        | ⭐⭐⭐        | Canvas2D                   |
| 12  | **Comping / take lanes**      | High       | ⭐⭐⭐⭐      | Canvas2D + React           |
| 13  | **Unlimited undo**            | High       | ⭐⭐          | Command pattern            |
| 14  | **Spectrum analyzer (EQ)**    | High       | ⭐⭐⭐⭐⭐    | WebGPU                     |
| 15  | **VU meters with ballistics** | Medium     | ⭐⭐⭐⭐      | Canvas2D                   |
| 16  | **MIDI learn**                | Medium     | ⭐⭐⭐        | WebMIDI API                |
| 17  | **Track freeze/bounce**       | Medium     | ⭐⭐          | OfflineAudioContext + Rust |
| 18  | **Snap modes**                | Medium     | ⭐⭐⭐        | TypeScript                 |

### Tier 3 — Differentiators

| #   | Feature                       | Complexity | Visual Impact | Tech                              |
| --- | ----------------------------- | ---------- | ------------- | --------------------------------- |
| 19  | **Modulation halo system**    | Very High  | ⭐⭐⭐⭐⭐    | CSS conic-gradient + audio engine |
| 20  | **Nested device chains**      | Very High  | ⭐⭐⭐⭐      | React + audio graph               |
| 21  | **Spectrogram (waterfall)**   | High       | ⭐⭐⭐⭐⭐    | WebGPU compute shader             |
| 22  | **Stereo goniometer**         | Medium     | ⭐⭐⭐⭐      | Canvas2D                          |
| 23  | **LUFS loudness metering**    | High       | ⭐⭐⭐⭐      | Rust/AudioWorklet + Canvas        |
| 24  | **Per-note expression (MPE)** | Very High  | ⭐⭐⭐⭐      | Canvas2D + audio engine           |
| 25  | **Chord stamps + strum**      | Medium     | ⭐⭐⭐        | Canvas2D + TypeScript             |
| 26  | **Routing matrix**            | High       | ⭐⭐⭐        | HTML grid + SVG                   |
| 27  | **Mixer snapshots**           | Medium     | ⭐⭐          | JSON serialization                |
| 28  | **Ripple editing**            | Medium     | ⭐⭐⭐        | TypeScript                        |

### Tier 4 — Advanced

| #   | Feature                            | Complexity | Visual Impact | Tech                      |
| --- | ---------------------------------- | ---------- | ------------- | ------------------------- |
| 29  | **Phase correlation meter**        | Low        | ⭐⭐⭐        | Canvas2D                  |
| 30  | **Oscilloscope**                   | Medium     | ⭐⭐⭐⭐      | Canvas2D                  |
| 31  | **Compressor gain reduction viz**  | High       | ⭐⭐⭐⭐      | Canvas2D                  |
| 32  | **Wavetable 3D display**           | High       | ⭐⭐⭐⭐⭐    | WebGPU                    |
| 33  | **Spectral editing (in-timeline)** | Very High  | ⭐⭐⭐⭐⭐    | WebGPU + Canvas           |
| 34  | **XY pad controls**                | Low        | ⭐⭐⭐        | Canvas2D/SVG              |
| 35  | **VCA fader groups**               | Medium     | ⭐⭐          | Audio graph + React       |
| 36  | **Chord track / scale quantize**   | High       | ⭐⭐⭐        | Canvas2D + TypeScript     |
| 37  | **Groove extraction**              | Medium     | ⭐⭐          | TypeScript + analysis     |
| 38  | **Built-in tuner**                 | Low        | ⭐⭐          | Web Audio autocorrelation |
| 39  | **3D spatial audio panner**        | High       | ⭐⭐⭐⭐      | WebGPU/Canvas             |
| 40  | **AI stem separation**             | High       | ⭐⭐⭐        | Rust/ONNX backend         |

---

## Part 10: 26-week build order

### Phase 1 — Core skeleton (weeks 1–4)

1. Track list + arrangement timeline (empty tracks, headers, color labels, virtual scroll)
2. Transport controls (play/stop/record, tempo, time signature, playhead, ruler)
3. Audio engine connection (Web Audio graph, Rust/Tauri file loading with symphonia)
4. Waveform rendering (mipmap pre-computation on import — **first wow moment**)
5. Basic mixer (faders, pan, solo/mute, peak meters, color sync)

### Phase 2 — MIDI and piano roll (weeks 5–8)

6. Piano roll — full FL Studio-inspired: draw/delete, velocity lane, grid, zoom, selection tools
7. Ghost notes from other tracks
8. Scale highlighting and snap-to-scale
9. Basic quantize (grid values, strength, swing)
10. Chord stamps + step sequencer

### Phase 3 — Visualization wow factor (weeks 9–12)

11. **Spectrum analyzer** — FabFilter-style FFT display behind EQ nodes (WebGPU) — **most impactful screenshot feature**
12. **Modulation halo system** — CSS halos, drag-to-modulate, color-coded sources — **most viral feature**
13. VU meters with 300ms ballistics replacing basic peak meters
14. **Spectrogram** — WebGPU texture scrolling, time-frequency heat map
15. Goniometer with phosphor decay

### Phase 4 — Professional workflow (weeks 13–18)

16. Automation system (multi-lane, Bezier curves, R/W/T/L modes, clip + track level)
17. Comping / take lanes (loop recording, swipe selection, auto-crossfade)
18. Clip fades and gain (drag handles, curve shapes, crossfade on overlap)
19. **Session/clip launcher** — side-by-side with arrangement, scene triggers, performance record
20. Non-destructive undo (command pattern, history panel)
21. Track freeze/bounce
22. Snap modes (adaptive, fixed, events, markers, free)
23. MIDI learn and controller mapping

### Phase 5 — Differentiating features (weeks 19–26)

24. Nested device chains (container devices for multiband, parallel, mid/side)
25. Per-note expression / MPE
26. LUFS metering with EBU R128 history graph
27. Routing matrix grid view
28. Ripple editing
29. Mixer snapshots
30. Spectral editing in-timeline

---

## Part 11: Implementing the three highest-impact features

### FabFilter-style spectrum analyzer

1. `AnalyserNode` with `fftSize: 4096` after track output
2. `getFloatFrequencyData()` into `Float32Array(2048)` at 30–60fps
3. Perceptual tilt: `adjusted[i] = raw[i] + 4.5 * log2(f / 1000)` per bin
4. Smoothing: `smoothed = prev * 0.85 + current * 0.15` per frame
5. WebGPU: upload Float32Array to storage buffer via `device.queue.writeBuffer()`, render instanced quads with gradient coloring
6. EQ nodes: overlay draggable handles at band frequency/gain, render EQ curve via `BiquadFilterNode.getFrequencyResponse()`
7. Spectrum Grab: hover to freeze spectrum into secondary buffer, click-drag to find nearest peak, create EQ band with auto-calculated Q

### Modulation halo system

1. Each parameter stores: `{ connections: Array<{ sourceId, depth, bipolar, polyphonic }> }`
2. Audio engine evaluates modulators, writes current values to SharedArrayBuffer
3. Routing mode: CSS class toggle renders blue/green overlay on available targets
4. Halo: CSS `conic-gradient` with `--mod-start` and `--mod-end` custom properties updated from SAB at 30fps. `will-change: background` for GPU compositing
5. Real-time sweep: `--mod-current` property for animated position indicator
6. Drag-to-modulate: enter routing mode on drag start, preview on hover (audition before commit), create connection on drop, scroll to adjust depth

### Piano roll ghost notes

1. When editing Track A, query project state for all MIDI notes in other tracks overlapping current time range
2. Draw ghost notes as `fillRect` at 20% opacity in muted color, behind active note layer but above grid
3. Double-click: switch active editing to that track
4. Performance: only query notes within visible viewport using same spatial index (sorted array or interval tree) as active notes

---

## Strategic conclusion

Three architectural decisions determine professional grade:

**Invest heavily in the piano roll** — it's the feature users discuss, compare, and switch DAWs over more than any other. FL Studio-quality with ghost notes, chord stamps, scale highlighting, and MPE expression will immediately differentiate.

**Implement modulation halos early** — the single most visually distinctive feature in modern DAW design, generates viral social media interest, and fundamentally changes sound design interaction.

**Use WebGPU for spectrum analyzer and spectrogram** — these two visualizations alone communicate "professional audio tool" in a single screenshot.

The community has spoken: **FL Studio piano roll + Bitwig modulation + Ableton Session View + Reaper routing + Logic stock plugin quality + Linux support + plugin sandboxing + AI stem separation**. No incumbent delivers all of these. That gap is the opportunity.
