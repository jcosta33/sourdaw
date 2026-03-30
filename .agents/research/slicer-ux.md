# Slicer — Design Specification for Sourdaw's Loop Slicer & Beat Chopper

**Plugin:** Slicer · **Platform:** Sourdaw DAW (Tauri v2 + React 19 + Rust DSP) · **Version:** 1.0 Design Spec · **Part:** 1 of 2 (Design Only)

Slicer is a professional loop slicer and beat chopper that transforms any audio loop into a playable, rearrangeable instrument in under five seconds. It combines the instant sensitivity feedback of ReCycle, the zero-friction workflow of Ableton's Slice-to-MIDI, the per-slice routing depth of FL Studio's Slicex, and a built-in step sequencer with generative chaos controls — all inside Sourdaw's five-level progressive disclosure system. The design goal is simple: **drop a loop, jam immediately, build a beat, export it.** Every design decision flows from the conviction that a slicer is an instrument, not an editor.

---

## 1. Competitive analysis and design benchmarks

### ReCycle (Propellerhead / Reason Studios) — the original, still instructive

ReCycle's interface is a single window dominated by a large waveform display with the **Sensitivity slider** positioned prominently on the left side. The top row contains transport controls, tempo, pitch knob (±24 semitones), gain, and gate sensitivity. Below the waveform sit three tabbed processors — Envelope, Transient Shaper, and a 4-band EQ. A toggleable grid overlay divides the sample into 16th-note sections.

The workflow is drag-right-and-see: load an audio file, drag the Sensitivity slider rightward, and watch slice markers appear on the waveform in real time at detected transients. Further right means more peaks detected, more slices. Users can lock individual markers so they persist when sensitivity changes, add or delete markers manually, and mute individual slices. Preview mode triggers a dialog for loop length and time signature, then allows independent tempo and pitch adjustment. Export produces REX2 files (lossless, auto-adjust to host DAW tempo) or individual slices plus a Standard MIDI File.

What makes it fast is the **one-control-does-90%-of-the-work** design. The sensitivity slider with real-time visual feedback collapses multi-step transient detection configuration into a single gestural action. The user can "feel" the right number of slices by watching the waveform while dragging. The locked/unlocked slice system lets users combine automatic detection with manual refinement without losing work. The single-window interface means zero context-switching.

What makes it slow is its standalone architecture (not a plugin, requires file export/import), no undo history for slice operations, and global-only processing — the same Envelope/Transient Shaper/EQ applies to all slices, not per-slice. The 5-minute sample limit and 99-slice cap in Dr. Rex are constraints of the era.

**Strongest design idea to steal:** The sensitivity slider with real-time visual feedback. One continuous control maps directly to the core algorithm parameter (transient detection threshold) with immediate visual consequence — slice markers appearing and disappearing on the waveform as the user drags. This interaction pattern has been copied by virtually every subsequent slicer because it transforms an abstract signal-processing parameter into something spatial and intuitive.

### Ableton Simpler (Slice mode) — the fastest loop-to-instrument workflow

Simpler lives in Ableton's Device View as a narrow horizontal strip. Three mode tabs (Classic, 1-Shot, Slice) sit on the far left. The center is dominated by the waveform display with vertical slice markers. Below: a Slice By dropdown (Transient, Beat, Region, Manual), sensitivity number, playback mode selector (Mono, Poly, Thru), and warp controls. The bottom strip contains a persistent filter section (12 types including Cytomic-modeled filters), LFO, basic amplitude ADSR, and volume.

The killer workflow is **"Slice to New MIDI Track"**: right-click any warped audio clip, select the command, and Ableton creates a new MIDI track with a Drum Rack containing one Simpler per slice, plus a MIDI clip arranged chromatically that reproduces the original timing. The user immediately has a working reproduction they can deconstruct and rearrange. The inline Simpler Slice mode is nearly as fast — drag a sample onto a MIDI track, click the Slice tab, adjust sensitivity, and play from a MIDI keyboard or Push pads.

The speed comes from **three-action-to-playable**: drag → click Slice → done. Deep DAW integration means slices are immediately available in the same environment. Push hardware integration allows "pad slicing" — creating slice markers in real time by hitting pads while the sample plays. Warp engine integration means sliced loops auto-sync to project tempo.

The friction points: the sensitivity control is a number field rather than a continuous slider (less tactile than ReCycle), the Device View panel is cramped without pop-up mode, and per-slice effects require converting to a Drum Rack — a one-way operation. No prominent visual pad grid exists in the software alone.

**Strongest design idea to steal:** The one-click "Slice to New MIDI Track" command that generates BOTH the instrument (Drum Rack with per-slice samplers) AND the sequencing data (MIDI clip reproducing original timing) simultaneously. This bridges the gap from audio loop to playable instrument in a single action.

### FL Studio Slicex — maximum depth, maximum complexity

Slicex uses a multi-panel resizable window with three major sections. The Master Panel holds master level, randomness, LFO, pitch knobs, and an X/Y Modulation Pad with layering controls (velocity-mapped, random, cycle modes with crossfade curves). The Articulation Panel is the deep heart: per-region controls for output routing (each slice to its own mixer track), choke groups, amplitude, filter, speed, and start position, with **8 independent articulators** each containing filter, envelope, and modulation routing with 6 targets (PAN, VOL, CUT, RES, SPEED, START) and 6 sources (ENV, LFO, VEL, MOD X, MOD Y, RAND). The Wave Editor at the bottom is essentially a full waveform editor with auto-slice options (Dull/Medium/Sharp for transient detection, or grid-based slicing).

What makes it powerful is per-region mixer track routing — each slice can go to its own mixer channel for completely separate effects chains, EQ, compression, and spatial processing. The articulation system with **up to 288 potential envelope configurations** (8 articulators × 6 targets × 6 sources) provides granular per-slice sound design. Dual deck loading supports two independent samples.

What makes it slow: the learning curve is brutal. Only three auto-slice presets (Dull/Medium/Sharp) with no continuous sensitivity slider — widely criticized by users as insufficient. Per-slice configuration is tedious for large slice counts. The three-panel hierarchy creates deep navigation. Documentation is outdated.

**Strongest design idea to steal:** Per-region mixer track routing as a first-class UI feature. The ability to send individual slices to independent DAW output channels directly from within the slicer UI, turning a single loop into a fully broken-out multitrack arrangement.

### NI Maschine chop workflow — the pad-centric paradigm

Maschine's software shows a Sound/Group list (16 sounds per group, color-coded), with the Sample Editor's Slice page displaying a large zoomable waveform and vertical slice markers. Below: slice mode selector (Auto, Grid, Manual, Detect), threshold/sensitivity controls, and the Apply button. The hardware MK3 features **16 multi-color velocity/pressure-sensitive pads** in a 4×4 grid, two high-res color displays above 8 rotary encoders, and dedicated mode buttons.

The transformative workflow is **Live/Manual Slicing**: the sample plays back, and the user hits successive pads in real time to drop slice markers at the current playback position. Pad 1 starts playback; Pad 2+ add slice points as the sample plays. This transforms slicing from a visual mouse task into a **musical, performative act** — the body's timing becomes the editing tool. After applying, slices map to individual pads with independent tuning, filter, envelope, and effects chains. Auto-detect mode with adjustable sensitivity handles automated slicing.

The hardware integration is what separates Maschine: one-button mode switching (SAMPLING → SLICE → pads), hardware knobs auto-mapping to current per-pad parameters, and the physical velocity/pressure response creating groove naturally. Software-only users miss the Live Slice mode entirely.

**Strongest design idea to steal:** Live slicing via pad performance during playback. The gesture of hearing-and-hitting to place slice points is the gold standard for "slicing by feel" and should be supported via MIDI controller input.

### Serato Sample — find and chop in seconds

A single-window design built for speed: header bar with BPM (click-drag adjustable with ½/×2 buttons), key display with shift controls, sync toggle, and stem separation buttons (Vocals, Melody, Bass, Drums — each toggleable with individual level knobs). The center shows a large **frequency-colored waveform** (Serato DJ-style — red for bass through blue for highs) with a smaller overview strip above. Below: up to **32 colored pads** (originally 8), color-matched to the frequency content at each cue point position. Per-pad controls for attack, release, reverse, filter, level, time-stretch, and pitch.

The speed weapon is the **"Autoset / Find Samples" button**: one click and the algorithm analyzes the entire audio file, placing cue points at the most musically interesting positions — not just transients, but phrase boundaries, harmonic moments, and rhythmically significant points. Press again for alternatives. Combined with frequency-colored waveforms (visually identify kick, snare, and hi-hat by color), instant BPM/key detection, and keyboard letter shortcuts on pads (play immediately without MIDI setup), the path from drag-drop to playable instrument is remarkably short.

Weaknesses include no built-in sequencer (entirely dependent on host DAW), no velocity sensitivity in the plugin itself, a non-resizable GUI, and divisive time-stretch quality.

**Strongest design idea to steal:** The one-click intelligent cue placement algorithm ("Autoset") that finds musically meaningful positions automatically, plus the frequency-colored waveform that makes visual slice identification instant by color.

### Logic Pro Quick Sampler (Slice mode) — Apple's progressive disclosure masterclass

Quick Sampler divides into an upper Sample/Slicing area and a lower collapsible Synth/Modulation section. The waveform display uses a dual-color marker system: **yellow markers** (auto-detected, respond to sensitivity) and **orange markers** (manually created or locked with "Ignore Sensitivity," persist regardless of slider position). Note names display at the bottom of each marker. Play icons appear on hover for inline auditioning. Slice controls include mode popup (Transient, Beat Divisions, Equal Divisions), sensitivity slider, start key mapping (Chromatic, White keys only, Black keys only), and Flex/tempo controls.

The lower section reveals depth when needed: pitch envelope, extensive filter types with ADSR, amplitude envelope, two LFOs, and a full modulation matrix. The Action popup menu houses "Copy MIDI Pattern" and "Create Drum Machine Designer Track" — the equivalent of Ableton's Slice-to-MIDI.

The Apple approach hides complexity until needed. The lower synthesis section collapses, advanced operations live in menus, and the default experience is just waveform + sensitivity slider + play. Three slicing modes (Transient, Beat Divisions, Equal Divisions) cover all common cases. Key mapping options (Chromatic, White-only, Black-only with configurable start key) accommodate different controller layouts.

**Strongest design idea to steal:** The yellow/orange dual-marker sensitivity system. Auto-detected markers respond dynamically to the sensitivity slider; manually placed or locked markers persist regardless. Two colors, zero added UI complexity, solves the real problem of "sensitivity changes delete my careful manual work."

### iZotope BreakTweaker — the microscope view of each beat step

BreakTweaker uses a three-section layout: a 6-track pattern overview (each track with independent length and speed for polyrhythmic patterns), a Generator page (3 generators per track, switchable between wavetable synthesis and samples), and the signature **MicroEdit Engine**. When a step is selected, MicroEdit subdivides that individual step into micro-slices with curve-shaped control over divisions, pitch, speed, pan, and gate. A single 16th-note kick hit can morph from discrete hits into a pitched tone through micro-subdivision and pitch-ramping.

The paradigm shift: **each sequencer step is a micro-universe** that can be subdivided, pitch-ramped, gated, and effect-processed independently. Per-step spot effects mean a single hit can have its own bitcrusher or filter without track-level automation. Independent track lengths enable polyrhythmic patterns by simply dragging a handle.

Critical weaknesses: no swing or shuffle (surprising for a beat tool), 2-bar maximum pattern length, no song mode, cannot play generators chromatically, and discontinued by iZotope in 2022.

**Strongest design idea to steal:** The per-step microscopic subdivision concept — treating "one hit" not as atomic but as a canvas for granular manipulation. Slicer's retrigger and stutter controls in the step sequencer should draw from this philosophy.

### XLN Audio XO — AI-powered spatial sound browsing

XO's signature is the **XO Space**: a large 2D zoomable visualization where every one-shot drum sample in the user's library appears as a colored dot. Color indicates instrument type (red = kicks, blue = snares, yellow = hi-hats). Spatial arrangement uses **t-SNE (t-Distributed Stochastic Neighbour Embedding)** — similar-sounding samples cluster together; dissimilar ones sit far apart. Users sweep the mouse across the space, triggering each dot on mouseover for instant audition. A Similarity List shows the 15 most similar samples to the current selection. Hot Swap mode lets users browse while a beat plays, hearing each candidate in context instantly.

The Edit View provides an 8-lane, 16-step sequencer with hexagonal cells, per-lane sound design controls, groove templates, and the **Accentuator** — a cyclic accent system using superimposed wave cycles for organic, non-repetitive velocity patterns. The Playground mode enables per-lane preset pattern randomization with lane locking.

**Strongest design idea to steal:** The spatial/perceptual approach to sound organization, where proximity equals sonic similarity. While Slicer is not a sample browser, the principle of **visual clustering and spatial navigation** could inform how slices are visualized — similar-sounding slices grouped together, or a "slice similarity map" as an alternative to linear waveform ordering. More practically, XO's Accentuator concept (cyclic accent patterns for organic velocity variation) directly applies to Slicer's step sequencer.

---

## 2. The "chop and flip" cultural context

### How MPC producers invented a compositional language

The loop slicer is not just an audio tool — it is the engine of a distinct musical tradition. Understanding this culture is essential to designing Slicer correctly, because the interaction model must support creative practices that emerged from hardware instruments over three decades.

**J Dilla** defined the paradigm. Working primarily on an Akai MPC 3000, he micro-chopped samples into **sub-one-second fragments** (often eighth-note length or shorter) and reassembled them into entirely new melodies. Questlove witnessed Dilla break down a Roy Ayers drum break into 32 different less-than-one-second fragments from different parts of the song, then piece them together to create the beat for Black Star's "Little Brother" — all while Questlove was out getting lunch. Crucially, Dilla turned off the MPC's quantize function, finger-drumming beats live and leaving human timing imperfections intact. This created what Dan Charnas coined **"Dilla Time"** — a deliberate tension between quantized and unquantized elements that is neither standard swing nor straight time. On Slum Village's "Players," he manipulated a vocal from The Singers Unlimited's "Clair," chopping, pitching, and filtering the word "Clair" to sound like "players" — a word that doesn't exist in the original. Mixdown Magazine wrote: "The way J Dilla used his MPC3000 is essentially the hip-hop equivalent of Jimi Hendrix's relationship with his Fender Stratocaster."

**Madlib** pushed the SP-303 to its limits through a performance-based workflow that bypassed sequencing entirely. He does not use the SP-303's internal sequencer — instead, he samples, chops, and triggers all beats live into a Tascam multitrack recorder, then deletes the samples and makes the next beat. The SP-303's built-in compressor, isolator, and vinyl simulator effects are integral to his sound; the heavy compression creates the signature "ducking" effect where volume drops when the kick hits. Madvillainy was made entirely on the SP-303 in settings including a São Paulo hotel room. His source material spans Bollywood, African records, Turkish funk, Japanese jazz, and Eastern European psych-rock.

**Pete Rock** made the sampler his instrument explicitly: "I promised myself I would make the sampler my instrument. So I read the manual, like, fifty times." Working primarily on the E-mu SP-1200 and Akai S950, he pioneered the use of horn stabs, filtered layers, and intro/outro beats (short instrumental excerpts completely different from the main song). Almost everything was done with turntable and SP-1200 — no outboard EQs, all frequency shaping came from the DJ mixer during sampling or from the SSL console during mixing.

**DJ Premier** is where "the whole idea of chopping became involved," according to 9th Wonder. His approach on the MPC60 and S950 was to chop "in a way musicians would play" — maintaining musicality within the fragments. **Kanye West** pioneered **chipmunk soul** — pitching up soul and R&B vocal samples to create sped-up, high-pitched hooks, partly because "you had to turn the turntables on to 45 to get more sample time" on limited hardware. **9th Wonder** proved FL Studio could match hardware credibility, producing for Kendrick Lamar, Jay-Z, and Little Brother entirely in software.

### MPC swing: why timing is as important as slicing

Roger Linn invented both quantization and swing for his 1979 LM-1 Drum Computer and later designed the Akai MPC60 and MPC3000. His swing implementation is deliberately simple: **"I merely delay the second 16th note within each 8th note."** All even-numbered 16th notes are delayed by a variable amount:

- **50%** — no swing, equal time divisions
- **54%** — subtle looseness that "will loosen up the feel without it sounding like swing"
- **58%** — light shuffle
- **66%** — perfect triplet swing (first 16th gets 2/3 of time, second gets 1/3)
- **71%** — heavy swing approaching dotted-eighth-plus-sixteenth feel

Linn stated that three factors create the MPC's groove, in order of importance: swing, accurate dynamics (velocity-sensitive pads), and tight timing. The MPC's swing algorithm is technically reproducible in any DAW, but the combination of tactile pads, tight timing, velocity sensitivity, and the swing algorithm created a workflow where groove emerged naturally from playing.

**Design implication:** Slicer must implement both Linn-style quantized swing (the classic percentage-based delay of even 16th notes) AND support for unquantized/raw playback (Dilla-style human timing). The swing slider is not a secondary feature — it is as culturally important as the sensitivity slider.

### Chopping as compositional philosophy

The shift from linear looping (playing a sample straight through) to chopping (fragmenting and reassembling) represents a fundamental creative evolution. The producer moves from selector/arranger to **composer using fragments as musical building blocks**. Joseph Schloss's landmark ethnographic study _Making Beats_ established that sampling is not the result of musical deprivation but an aesthetic choice consistent with hip-hop values — "a strict set of rules that exalt creativity and originality above all." The best chopping renders the original source unrecognizable.

Ableton's "Slice to New MIDI Track" democratized this workflow for laptop producers, and FL Studio's Slicex pushed it further. But the shift from hardware to software sacrificed tactile immediacy (clicking a mouse is fundamentally different from hitting a velocity-sensitive pad), sonic character (the SP-1200's 12-bit sampling, the SP-303's gooey compressor), and the creative constraints that forced innovation.

**The core design principle:** Slicer must feel like an instrument, not an audio editor. The difference is immediacy, playability, and responsiveness. An instrument responds to touch; an editor responds to clicks. Pads must be immediately playable after dropping a loop. The shortest possible path from source material to performance: **drop a loop → auto-slice → pads light up → start playing.**

---

## 3. The five-level progressive disclosure UI model

Slicer follows Sourdaw's standard five-level progressive disclosure system. Each level reveals additional controls while preserving everything from previous levels. The level indicator sits in the top-right corner as five small circles (Play, Shape, Build, Route, Lab), with the active level highlighted.

### Level 1 — Play: "Drop a loop, jam immediately"

**What appears on screen:** The interface is intentionally sparse. The top half contains a **large waveform display** (approximately 60% of plugin height) showing the loaded audio with auto-detected colored slice regions as semi-transparent overlays. Each slice region cycles through a palette of **12 saturated, distinct hues** — slice 1 is amber, slice 2 is coral, slice 3 is teal, and so on. Thin vertical lines mark slice boundaries. A playhead line animates across the waveform during playback, and the currently-active slice region pulses brighter.

The bottom half contains the **16-pad grid** (4×4 layout) and a minimal transport area. Each pad shows its slice number and a tiny waveform thumbnail of its assigned slice. Pad colors match the corresponding slice region colors in the waveform. Above the waveform, a **drop zone** prompt ("Drop a loop here") appears when empty, plus a **BPM readout** (auto-detected, displayed in mono typeface) and a play/stop button.

**What happens on loop drop:** The user drags an audio file onto the waveform area or drop zone. Slicer instantly (1) renders the waveform, (2) detects BPM, (3) runs transient detection with a default "Suggest" algorithm that classifies the material and picks appropriate sensitivity, (4) assigns slices to pads (up to 16 per bank), and (5) illuminates pad colors to match slice colors. The entire process targets **under 2 seconds**. The loop is immediately playable — clicking or MIDI-triggering any pad plays that slice.

**Pad states at Level 1:**

- **Empty** — dark grey, slightly recessed, no waveform thumbnail
- **Assigned** — pad color matches slice color, shows tiny waveform thumbnail and slice number
- **Currently playing** — pad brightens/glows with a halo animation, waveform region pulses
- **Just triggered** — brief white flash animation (100ms), then returns to assigned state
- **Hovering** — subtle brightness increase, cursor changes to pointer

**No visible controls** beyond the drop zone, BPM readout, play/stop button, pad grid, and level selector. Zero configuration needed.

### Level 2 — Shape: "Tune each slice to taste"

Revealing Level 2 adds a **control strip** between the waveform and the pad grid.

**New controls in the strip:**

- **Sensitivity slider** (labeled "Slices") — a horizontal slider spanning approximately 40% of the strip width. As the user drags, the slice count updates in real-time on both the waveform (markers appear/disappear with smooth animation) and the pads (pads populate/depopulate). A numeric readout sits adjacent ("12 slices"). The slider uses **quadratic mapping** for intuitive response — the middle range produces the most useful variation. A small **"Suggest" button** (sparkle icon) sits beside the slider; clicking it re-analyzes the audio and auto-sets sensitivity based on spectral content classification.
- **BPM display** — now editable (double-click to type, scroll to adjust in 0.1 BPM increments, shift+scroll for 1 BPM steps)
- **Slice count indicator** — "12 slices" in mono typeface

**Per-pad controls** revealed by clicking an assigned pad (a popover panel appears above the pad):

- **Pitch** — metallic dome knob, coarse semitones (±24), snaps to semitone increments
- **Tune** — metallic dome knob, fine cents (±100), continuous
- **Gain** — metallic dome knob, dB scale (−∞ to +12 dB)
- **Reverse** toggle — illuminated button, flips the slice waveform in the pad thumbnail when active
- **Envelope** — three compact dome knobs: Attack (0–500ms), Hold (0ms–∞), Decay (0–5000ms)
- **Trigger mode selector** — four small buttons: One-shot (plays full slice once), Gated (plays while held, stops on release), Toggle (press to start, press again to stop), Loop (loops the slice continuously)

The waveform display now shows a **dual-color marker system** inspired by Logic's approach: auto-detected markers are the standard slice color; manually adjusted or locked markers display with an orange accent ring, persisting across sensitivity changes.

### Level 3 — Build: "Sequence and rearrange"

Level 3 replaces the bottom portion of the interface (below the waveform and control strip) with a **split view**: pad grid compressed to a smaller sidebar on the right, and a **step sequencer** occupying the main bottom area.

**Step sequencer layout:**

- **16 or 32 steps**, switchable via a toggle ("16 | 32") in the sequencer toolbar
- Each step is a **slightly raised rectangular cell** in a horizontal row. Active steps glow with the color of their assigned slice. Inactive steps are dim grey.
- When active, each cell shows: a miniature colored indicator matching the assigned pad/slice, and a **velocity bar** (vertical fill within the cell — taller = louder)
- The currently-playing step pulses with a bright highlight as the sequencer runs
- Steps are entered by clicking (toggles active/inactive); clicking an active step opens a **step editor popover**

**Step editor popover** (appears above the clicked step):

- Slice selector — dropdown or scrollable list of available pads/slices with color indicators
- Velocity — vertical slider (0–127)
- Pitch offset — ±12 semitones from the slice's base pitch
- Retrigger count — 1× (normal), 2×, 3×, 4×, 8× (stutters within the step duration)
- Reverse — toggle for this step only (independent of the slice's global reverse state)

**Waveform editing at Level 3:** The waveform becomes directly editable. **Slice boundary handles** (small diamond shapes at the top of each boundary line) appear and are draggable left/right to move boundaries. Clicking on the waveform between existing boundaries adds a new slice point. Right-clicking a handle opens a context menu with "Remove slice point" and "Lock this marker" options.

**Pattern tools toolbar** (above the step sequencer):

- Play/Stop — transport for the internal sequencer (independent of DAW transport, or linkable)
- Record — arms real-time recording of pad hits into the step sequence
- Loop toggle
- Pattern length selector (1–32 steps, dropdown)
- **Swing slider** — 50% to 75%, labeled with percentage and descriptive text ("50% Straight" / "58% Light" / "66% Triplet" / "71% Heavy"). Implements Roger Linn's algorithm: delays even-numbered 16th notes by the specified ratio
- **Randomize button** with adjacent **Chaos slider** (0–100%) — at 0%, randomize preserves original slice order but varies velocity; at 50%, half the slices are randomly reassigned; at 100%, all slices are fully randomized in order, velocity, and pitch offset. An "Undo" button adjacent to Randomize reverts the last randomization
- Clear button — resets all steps

### Level 4 — Route: "Output, choke, and velocity mapping"

Level 4 adds a **routing panel** that appears as a collapsible section above the step sequencer. The pad grid sidebar expands to show additional per-pad routing controls.

**Per-slice output routing:** Each pad now displays a small **output channel selector** (numbered 1–16). By default, all slices route to the main stereo output. Assigning a pad to output channel 3 sends that slice's audio to Sourdaw's mixer channel 3, enabling independent effects processing, EQ, and compression per slice.

**Choke group assignment:** Each pad shows a **choke group indicator** (letters A–H, or "—" for no group). Triggering any slice in choke group A immediately silences all other currently-playing slices in group A. Typical use: assign open hi-hat and closed hi-hat slices to the same choke group.

**Send level knobs:** Two small dome knobs per pad — **Delay Send** and **Reverb Send** (0–100%). These route to Sourdaw's global send effects buses.

**Velocity zone mapping:** A compact **velocity range editor** per pad — two handles on a horizontal bar representing the 0–127 velocity range. Overlapping zones on the same MIDI note enable velocity-switching between slices (e.g., soft hits trigger one slice, hard hits trigger another).

**MIDI learn:** A "MIDI Learn" toggle in the routing panel toolbar. When active, clicking a pad then pressing a MIDI key/pad assigns that MIDI note to the slice. Visual feedback shows the current MIDI note assignment on each pad.

### Level 5 — Lab: "Algorithms, exports, and deep configuration"

Level 5 adds a **Lab panel** as a tabbed section that replaces the routing panel (routing remains accessible as a tab). The Lab contains advanced configuration organized into collapsible groups:

**Transient detection configuration:**

- Algorithm selector — dropdown: Energy, High Frequency Content (HFC), Spectral Flux, Complex Domain, SuperFlux. Each option includes a one-line description ("Complex Domain — best for polyphonic/mixed material")
- FFT size — dropdown: 512, 1024, 2048, 4096 samples
- Hop size — dropdown: 128, 256, 512 samples
- Minimum inter-onset interval — slider, 10–200ms
- Pre-roll amount — slider, 0–50ms (captures the attack transient that precedes the onset detection point)
- Zero-crossing snap — toggle (snaps slice points to the nearest zero crossing to prevent clicks)

**Time-stretch configuration:**

- Algorithm selector per slice — dropdown: Repitch (pitch changes with speed, classic sampler behavior), WSOLA (time-stretch preserving pitch, good for rhythmic material), Formant-preserving (time-stretch preserving both pitch and formant character, best for vocals)
- Global vs per-slice toggle — when global, one algorithm applies to all slices; when per-slice, the algorithm selector appears in each pad's popover

**Beat grid settings:**

- Snap-to-grid toggle with grid resolution selector (1/4, 1/8, 1/16, 1/32)
- Grid offset — fine-tune grid alignment to loop start

**Import/Export:**

- REX2 import button — loads REX2 files with pre-defined slice points preserved
- Export individual slices as WAV — exports each slice as a separate WAV file to a user-selected directory, with filenames following the pattern `[loop_name]_slice_[n].wav`
- Export pattern as MIDI — generates a MIDI file with each slice mapped to a note, reflecting the current step sequencer pattern. Also copies the MIDI clip to Sourdaw's arrangement view
- Export bounced audio — renders the current pattern as a stereo WAV file
- **Send slices to Toaster** button — transfers all slices (with their per-slice settings: pitch, tune, gain, envelope, reverse) to Sourdaw's Toaster drum machine plugin as individual drum pads. A confirmation dialog shows the mapping preview before transfer

**Pattern chaining:** An expanded pattern system with A/B/C/D pattern slots visible in the sequencer toolbar, plus a chain editor where patterns can be ordered into a sequence (e.g., A → A → B → A → C → D).

---

## 4. Waveform display design

The waveform display is the visual and interactive centerpiece of Slicer. It occupies approximately **60% of the plugin height at Level 1**, compressing to approximately 40% at Levels 3–5 to accommodate the sequencer and panels below.

**Waveform rendering:** The audio waveform is drawn as a **filled path** (not individual vertical lines) showing peak amplitude, rendered in **warm amber/gold** (#D4A44C) on a **dark charcoal background** (#1E1E24). Stereo files display as a single merged waveform by default, with a toggle for split stereo display available at Level 5. The waveform fill uses a subtle vertical gradient — brighter at the amplitude peaks, darker toward the zero line — creating a sense of depth.

**Slice region overlays:** Each slice region is painted as a **semi-transparent colored overlay** (approximately 20% opacity) spanning the full height of the waveform, from the slice's start boundary to its end boundary. Colors cycle through a **12-hue palette** of saturated, distinct colors designed for maximum visual differentiation on the dark background:

1. Amber (#D4A44C) · 2. Coral (#E8665A) · 3. Teal (#4ABFAD) · 4. Violet (#9B6BB0) · 5. Chartreuse (#A4C639) · 6. Rose (#D4708A) · 7. Cyan (#52C4D9) · 8. Tangerine (#E89040) · 9. Lavender (#8A8AD4) · 10. Moss (#6BAF6B) · 11. Magenta (#C44FB0) · 12. Sky (#5A9ED6)

For loops with more than 12 slices, the palette cycles (slice 13 = amber again, but with a subtle brightness shift to maintain visual distinction).

**Slice boundary markers:** Each boundary is drawn as a **thin vertical line** (1.5px) at the slice point, colored slightly brighter than the slice region it borders. At the top of each line, a **draggable diamond handle** (8×8px) provides the grab target for manual editing. Auto-detected markers use the slice color; manually placed or locked markers display with an **orange accent ring** (Logic-inspired dual-marker system).

**Currently-playing indicator:** During playback, the **playhead** is a bright white vertical line (2px) that animates smoothly across the waveform. The currently-active slice region **brightens** (opacity increases from 20% to 45%) and its boundary lines pulse with a subtle glow animation. When a pad is triggered (not during sequencer playback), only the triggered slice's region brightens briefly (200ms fade-in, 500ms fade-out).

**Manual editing interactions (Level 3+):**

- **Drag handles** to move slice boundaries — the adjacent slice regions resize in real time, and pad thumbnails update live. A tooltip shows the exact position in samples and milliseconds.
- **Click on waveform** (between existing boundaries) to add a new slice point — a new marker appears at the click position with a quick fade-in animation. The existing slice splits into two, and pads remap automatically.
- **Right-click on a handle** to open context menu: "Remove slice point" (merges the two adjacent slices), "Lock this marker" (persists across sensitivity changes, gains orange accent), "Unlock."
- When dragging a handle, **snap-to-zero-crossing** is active by default (shown as subtle resistance/detent behavior), overridable by holding Alt.

**Zoom and scroll:** A horizontal zoom control (slider or scroll-wheel-over-waveform) allows zooming from full-loop overview to sample-accurate detail. When zoomed in, the waveform scrolls horizontally via click-drag on the background or horizontal scrollbar. A **minimap/overview strip** (approximately 24px tall) sits directly below the main waveform, showing the full loop at all times with a highlighted rectangle indicating the currently visible region. Click-drag on the minimap to navigate quickly.

**Pad-color-to-waveform-color mapping:** Slice 1's region color exactly matches Pad 1's color. This one-to-one color mapping is the primary visual link between the spatial waveform representation and the grid-based pad interface. When hovering over a pad, the corresponding waveform region brightens. When hovering over a waveform region, the corresponding pad brightens.

**Waveform thumbnail in pads:** Each pad contains a **tiny waveform rendering** (approximately 40×20px) of its assigned slice, drawn in the pad's color on a slightly darker background. This thumbnail updates in real time when slice boundaries are moved, when reverse is toggled (the waveform flips horizontally), or when sensitivity changes reassign slices.

---

## 5. Pad grid design

The pad grid is a **4×4 matrix of 16 pads**, styled to match Sourdaw's skeuomorphic design language with a physical, tactile aesthetic.

**Pad visual design:** Each pad is a **rounded square** (approximately 64×64px at default plugin size, scalable) with a subtle 3D appearance — a slight convex surface gradient suggesting a rubber pad surface, surrounded by a thin metallic bezel. The pad surface color matches its assigned slice's color from the waveform palette. An inner shadow at rest suggests depth; on press, the shadow inverts to suggest physical depression.

**Pad content (per pad):**

- **Slice number** — small, top-left corner, mono typeface, semi-transparent white (#FFFFFF at 60%)
- **Tiny waveform thumbnail** — centered, showing the slice's waveform shape in a slightly lighter tint of the pad color
- **Slice name** (optional, Level 2+) — small text below the thumbnail, truncated with ellipsis if too long. Defaults to "Slice [n]"; editable via right-click → Rename

**Pad states:**

- **Idle (assigned)** — pad color matches slice color, convex surface gradient, standard inner shadow. Waveform thumbnail visible.
- **Armed** (recording mode at Level 3) — pad border pulses with a red glow
- **Playing (held)** — pad color brightens by 30%, inner shadow inverts to simulate physical depression, a bright halo extends 2px beyond the bezel. Waveform region in the display above brightens simultaneously.
- **Just triggered (flash)** — brief white flash overlay (80% opacity) lasting 100ms, then rapid fade to playing state or back to idle
- **Empty (unassigned)** — dark grey (#2A2A32) with no waveform thumbnail, no slice number. Slight concave appearance (inverted gradient from assigned pads). Clicking plays nothing; drag-drop a slice from the waveform to assign.

**Overflow handling (more than 16 slices):** When the slice count exceeds 16, a **bank switcher** appears directly above the pad grid — compact tab-style buttons labeled "A," "B," "C," etc. (Bank A = slices 1–16, Bank B = slices 17–32, etc.). The active bank tab glows with an accent color. Switching banks is instant; the waveform display highlights the slice regions belonging to the active bank while dimming others. Keyboard shortcuts: Shift+Left/Right to switch banks.

**Right-click pad context menu:**

- Rename — opens inline text field on the pad
- Clear — removes slice assignment, pad returns to empty state
- Send to Toaster — transfers this individual slice (with settings) to Sourdaw's Toaster drum machine
- Copy — copies slice assignment and all per-slice settings to clipboard
- Paste — pastes clipboard slice onto this pad
- Solo — solos this pad (mutes all others)
- Mute — mutes this pad

**Drag-to-reorder:** At Level 2+, pads are reorderable by drag. Click-and-hold a pad for 300ms to enter drag mode (pad lifts with a drop shadow animation), then drag to another pad position to swap. This changes which MIDI note the slice responds to (pad position determines MIDI mapping: bottom-left pad = C1, chromatically ascending left-to-right, bottom-to-top, matching MPC convention).

---

## 6. Step sequencer design

The step sequencer appears at Level 3 and occupies the lower portion of the plugin, to the left of the compressed pad grid sidebar.

**Grid layout:** A horizontal row of **16 or 32 step cells**, switchable via a "16 | 32" toggle in the sequencer toolbar. Each cell is a **slightly raised rectangular button** (approximately 32×48px at 16-step mode, narrower at 32-step mode) arranged in a single row with 1px gaps. Steps are grouped visually into beats — a slightly wider gap (3px) every 4 steps, with beat numbers (1, 2, 3, 4) displayed above.

**Step cell states:**

- **Inactive** — dark grey (#2A2A32), flat appearance, subtle border
- **Active** — glows with the color of the assigned slice. The interior shows: a **colored dot** (top, matching slice color) indicating which pad/slice plays, and a **velocity bar** (bottom, vertical fill — taller fill = higher velocity, ranging from 10% to 100% cell height). The fill color is a lighter tint of the slice color.
- **Currently playing** — the active step receives a bright white border and a pulsing glow animation that moves with the playhead. The corresponding pad in the sidebar simultaneously shows its "playing" state.

**Step entry and editing:**

- **Click an inactive step** → activates it with the most recently selected pad/slice and default velocity (100)
- **Click an active step** → opens the **step editor popover** above the step
- **Right-click a step** → quick context menu: Clear step, Copy step, Paste step
- **Shift+click** → toggles step active/inactive without opening popover
- **Click+drag vertically on an active step** → adjusts velocity directly (drag up = louder, drag down = softer), shown as the velocity bar updating in real time

**Step editor popover contents:**

- **Slice selector** — a compact scrollable grid of pad color-swatches with slice numbers. Click a swatch to assign that slice to this step. The currently assigned slice has a bright border.
- **Velocity** — vertical slider, 0–127, with numeric display
- **Pitch offset** — horizontal slider, ±12 semitones, with detents at semitone intervals
- **Retrigger count** — selector buttons: 1× (normal), 2×, 3×, 4×, 8×. Higher values subdivide the step duration, creating stutter effects. At 4×, the slice triggers 4 times within the step duration, each at 1/4 the step length.
- **Reverse** — toggle button. When active, this step plays its slice in reverse regardless of the slice's global reverse state.

**Pattern controls toolbar** (horizontal bar above the step grid):

- **Play/Stop** — toggles internal sequencer playback (syncs to DAW transport when sync is enabled)
- **Record** — arms real-time recording; pad hits during playback are captured into the nearest step
- **Loop** — toggles sequencer looping
- **Pattern length** — dropdown selector (1–32 steps)
- **Swing** — compact slider with percentage label (50%–75%)
- **Randomize** — button with an adjacent **Chaos slider** (0%–100%). Clicking Randomize applies randomization at the current chaos level. **Undo** button immediately adjacent to revert.
- **Clear** — resets all steps to inactive (with confirmation if pattern is non-empty)

**Multiple patterns:** Four **pattern slot buttons** (A, B, C, D) sit in the toolbar. Click to switch between independent patterns. The active pattern glows. Each pattern stores its own steps, assigned slices, velocities, pitch offsets, retrigger values, and reverse states. At Level 5, pattern chaining allows ordering these into a sequence.

**Visual motion:** During playback, the currently-playing step is highlighted with a smooth left-to-right animation. At swing values above 50%, the visual timing of step highlights reflects the actual swung timing — even-numbered steps visually "lean" late, reinforcing the rhythmic feel.

---

## 7. Visual design language

Slicer adheres to Sourdaw's established skeuomorphic design system, consistent with Crust, Crumb, Grinder, Bacteria, Proof, and Toaster.

**Knob design:** All rotary parameters (pitch, gain, tune, envelope knobs, send levels) use Sourdaw's **metallic dome knob** — a circular control with a realistic brushed-metal surface, subtle specular highlight that tracks rotation angle, and a fine indicator line from center to edge showing current value. Knobs have a slightly raised bezel and cast a soft drop shadow. Interaction: click-drag vertically to adjust (up = clockwise/increase, down = counterclockwise/decrease). Double-click to reset to default. Shift+drag for fine adjustment.

**Pad physical feel:** Pads simulate rubber MPC-style pads with a convex surface gradient at rest. On mouse-down, the gradient inverts (convex → flat/concave), the inner shadow shifts from top-left to bottom-right (simulating light source change from depression), and the pad color brightens — all within a **50ms CSS transition** for a snappy physical press feel. On release, the pad springs back over 120ms.

**Color palette:**

- **Waveform:** Warm amber/gold (#D4A44C) on dark charcoal (#1E1E24)
- **Backgrounds:** Deep charcoal (#1E1E24) for main background, slightly lighter (#252530) for panels and sections, darker (#16161C) for recessed areas (drop zones, inactive elements)
- **Slice region colors:** The 12-hue palette specified in Section 4, at 80% saturation and 65% lightness — saturated but not neon, distinct but not garish
- **Accent/interactive:** Bright white (#FFFFFF) for playhead and active borders, orange (#E89040) for locked/manual markers, red (#E85A5A) for record arm and destructive actions
- **Text:** White (#FFFFFF at 90%) for primary labels, white (#FFFFFF at 60%) for secondary labels and slice numbers, mono typeface for all numeric displays

**Step sequencer cells:** Slightly raised rectangular buttons with a 1px border in a darker shade of their fill color. Active cells glow — the fill color is the assigned slice's color at 70% opacity, with a subtle inner glow. The currently-playing step adds a white outer glow (box-shadow: 0 0 8px rgba(255,255,255,0.6)).

**Typography:**

- **Mono typeface** (e.g., JetBrains Mono or similar) for: BPM display, slice count, sample position/time readouts, velocity values, step numbers
- **Sans-serif** (e.g., Inter or system sans-serif) for: labels, menu items, button text, slice names, popover content
- **Size hierarchy:** 11px for secondary labels, 13px for primary labels and controls, 16px for BPM and prominent numeric displays, 10px for pad slice numbers

**Animations and transitions:** All state changes use hardware-accelerated CSS transitions. Pad press: 50ms. Step highlight: 30ms. Slice region brightness pulse: 200ms ease-in-out. Waveform marker appear/disappear on sensitivity change: 150ms fade. Playhead: requestAnimationFrame-driven smooth motion at 60fps.

**Plugin dimensions:** Default size 800×600px, resizable with aspect ratio preservation (minimum 640×480, maximum limited by screen). All elements scale proportionally. The waveform display, pad grid, and sequencer maintain their relative proportions across sizes.

---

## 8. Key interaction flows

### Flow 1 — Basic workflow: drop → jam (target: under 5 seconds)

1. User opens Slicer on a MIDI/instrument track in Sourdaw (Level 1 is the default view)
2. User drags an audio file (WAV, AIFF, FLAC, MP3) from Sourdaw's browser, file system, or arrangement onto the waveform drop zone
3. Drop zone text disappears. Within **500ms**: waveform renders with amber/gold fill on charcoal background
4. Within **1500ms**: BPM is detected and displayed, transient detection runs with auto-suggested algorithm and sensitivity, slice regions appear as colored overlays, boundary markers fade in, pads populate with slice colors and waveform thumbnails
5. User clicks any pad → that slice plays immediately. Or user triggers pads from a MIDI controller. Or user clicks Play → the loop plays back with slice regions highlighting in sequence
6. Total time from file drop to first pad trigger: **under 5 seconds**

### Flow 2 — Adjust sensitivity

1. User switches to Level 2 (clicks Shape circle or presses keyboard shortcut 2)
2. The control strip appears between waveform and pads, revealing the Sensitivity/"Slices" slider
3. User drags the slider rightward → slice count increases in real time: new boundary markers animate in on the waveform, new pads populate with color and thumbnail, the numeric readout updates ("8 slices" → "12 slices" → "16 slices")
4. User drags leftward → slice count decreases: boundary markers fade out, pads depopulate, readout decreases
5. Manually placed/locked markers (orange accent) persist regardless of slider position
6. At any point, user clicks the "Suggest" button → Slicer re-analyzes spectral content, smoothly animates the slider to the suggested position, markers update accordingly
7. User clicks a pad to audition the result at the new sensitivity

### Flow 3 — Edit a slice boundary

1. User switches to Level 3 (Build)
2. The waveform now shows draggable diamond handles at the top of each boundary line
3. User hovers over a handle → cursor changes to horizontal resize, handle enlarges slightly
4. User clicks and drags the handle left or right → the two adjacent slice regions resize in real time, pad thumbnails for both affected pads update live, a tooltip shows position (samples/ms)
5. Handle snaps to nearest zero crossing by default (subtle detent feel); user holds Alt to override and position freely
6. User releases → boundary is set. If the user navigates to a pad popover, the envelope and other per-slice parameters apply to the updated slice length

### Flow 4 — Build a pattern in the step sequencer

1. User is at Level 3 (Build). Step sequencer is visible below the waveform.
2. User clicks pad 3 in the sidebar to select it as the "active slice"
3. User clicks step cells 1, 5, 9, 13 → those steps activate with pad 3's color, creating a four-on-the-floor pattern with that slice
4. User clicks pad 7 to select it, then clicks steps 3, 7, 11, 15 → those steps activate with pad 7's color (e.g., snare on beats 2 and 4)
5. User clicks Play in the sequencer toolbar → the pattern plays back, step highlights move left to right, pads flash on each trigger, waveform regions pulse
6. User clicks an active step → step editor popover opens → adjusts velocity by dragging the slider, changes retrigger to 2× for a flam effect, closes popover
7. User adjusts Swing slider to 58% → even-numbered steps delay slightly, the groove loosens
8. User hits Record in the toolbar → plays pads in real time → pad hits are captured into the nearest steps, overwriting or layering as configured

### Flow 5 — Randomize and discover

1. User is at Level 3 with a pattern programmed
2. User sets the Chaos slider to 40% (moderate randomization)
3. User clicks Randomize → approximately 40% of steps have their slice assignments randomly changed to different pads; velocity varies by ±20%; a few pitch offsets are added (±1–3 semitones)
4. User clicks Play to audition → listens to the result
5. If unsatisfying: user clicks Undo (adjacent to Randomize) → pattern reverts to pre-randomization state. User adjusts Chaos to 70% and clicks Randomize again.
6. If partially satisfying: user manually edits specific steps to keep what works and fix what doesn't, then randomizes again at a lower Chaos value to vary only a few more steps
7. The workflow becomes: **randomize → audition → undo/keep → adjust chaos → repeat** — a generative creative loop

### Flow 6 — Send to Toaster

1. **Single slice:** User right-clicks a pad → selects "Send to Toaster" → the slice (with its pitch, tune, gain, envelope, reverse settings) appears on the next available pad in the Toaster drum machine plugin. A toast notification confirms: "Slice 4 → Toaster Pad 4"
2. **All slices:** At Level 5 (Lab), user clicks "Send all slices to Toaster" → a confirmation dialog shows the mapping preview (Slice 1 → Toaster Pad 1, Slice 2 → Toaster Pad 2, etc.) → user confirms → all slices transfer with settings. If Toaster doesn't exist on any track, Sourdaw creates a new instrument track with Toaster and loads the slices.

### Flow 7 — Export MIDI

1. User navigates to Level 5 (Lab) → Export section
2. User clicks "Export Pattern as MIDI"
3. Slicer generates a MIDI file where each slice is mapped to a note (starting from C1, chromatically ascending), with the step sequencer's pattern rendered as MIDI note events (preserving velocity, timing with swing, and note duration)
4. The MIDI clip appears on the current track in Sourdaw's arrangement view at the playhead position
5. Alternatively, a file save dialog allows exporting as a standard .mid file for use in other DAWs

---

## 9. Sensitivity as the core design problem

### Why this single control determines everything

Sensitivity — the threshold for transient detection — is the most important user-facing control in any loop slicer because it determines the **fundamental unit of creative manipulation**. Every downstream action (rearranging, pitching, reversing, sequencing) operates on slices, and if the slices don't align with musically meaningful events, the entire workflow breaks down. Getting sensitivity right is the difference between a tool that feels magical on first use and one that gets abandoned after two minutes of frustration.

The problem is formally unsolvable in the general case because "musically meaningful event" is subjective and context-dependent. A producer chopping a drum break wants each hit isolated. A producer chopping a jazz piano loop wants each chord. A producer chopping a full mix wants each phrase. The same threshold value produces radically different results on different material.

### The Goldilocks problem in practice

**Too few slices** (low sensitivity): Multiple drum hits get grouped into single slices. The user drops an 8-bar breakbeat expecting 32 slices and gets 6 — each containing multiple hits that can't be individually rearranged. The creative potential is locked inside monolithic chunks. Forum users describe this as "the slicer seeing the whole bar as one event."

**Too many slices** (high sensitivity): The algorithm triggers on reverb tails, ghost notes, amplitude fluctuations within sustained sounds, and noise. A clean 16-hit drum loop produces 47 slices, many containing 10ms of nothing useful. The pads fill with garbage fragments. FL Studio users report: "dull might result in 2 very random slices and medium might over-slice with a bunch of slices put close together near a single transient."

**Just right:** Each musically meaningful onset gets one slice. For a standard 2-bar drum break, this typically means **8–16 slices**. For a melodic loop, it depends on the note density. The user should reach this state with minimal effort.

### How different material types challenge sensitivity

**Drum loops** are the easiest case. Strong, short transients with clear gaps between hits create an ideal signal for onset detection. Energy-based, HFC, and spectral flux algorithms all perform comparably. The main pitfall is open hi-hats and cymbals causing false triggers from sustained high-frequency content.

**Melodic loops** (piano, guitar, synth) are harder. Transients are softer and more gradual, especially in legato passages. Energy-based detection fails because note onsets don't always produce sharp amplitude spikes. Complex domain or SuperFlux algorithms significantly outperform energy-based methods here because they track changes in both magnitude and phase, detecting new notes even at similar volumes.

**Full mix / vinyl samples** present the most challenging case. Multiple overlapping sources create a dense, complex transient landscape where every algorithm produces compromises. Neural network-based detectors (CNN/RNN) outperform all traditional methods on this material because they automatically learn separate detectors for percussive and harmonic onsets and combine them.

### Slicer's sensitivity design

Slicer addresses the Goldilocks problem through a layered approach:

**The primary control** is a continuous horizontal slider labeled "Slices" (not "Sensitivity" — the user-facing concept is the output, not the algorithm parameter). The slider uses **quadratic response mapping** so the perceptually useful middle range occupies the most slider travel. A **live slice count readout** sits adjacent ("12 slices"), updating in real time as the slider moves. The waveform display updates slice markers live — markers animate in and out smoothly as the slider moves, giving immediate spatial feedback about where slices will fall.

**The "Suggest" button** (sparkle icon beside the slider) runs a rapid analysis pipeline: (1) compute spectral centroid, flux statistics, onset rate, and temporal envelope characteristics; (2) classify material as primarily percussive, melodic, or mixed; (3) select the appropriate detection algorithm (HFC for percussive, Complex Domain for melodic, SuperFlux for mixed); (4) use beat detection to estimate tempo and expected events per bar; (5) binary-search for the threshold that produces a slice count close to the estimated event count; (6) animate the slider to the suggested position. This is a **significant competitive differentiator** — no mainstream slicer currently offers AI-assisted sensitivity suggestion.

**The dual-marker color system** (inspired by Logic Pro's approach) ensures manual work isn't destroyed by sensitivity changes. Auto-detected markers display in slice colors and respond dynamically to the slider. Manually placed or explicitly locked markers display with an orange accent ring and persist regardless of slider position. Two colors, zero added UI complexity.

**Advanced algorithm selection** is available at Level 5 (Lab) for users who want to choose between Energy, HFC, Spectral Flux, Complex Domain, and SuperFlux — along with FFT size, hop size, and minimum inter-onset interval. These controls are hidden from the 90% of users who will never need them.

---

## 10. Competitive differentiation

### What makes Slicer better than everything else

No existing tool combines all of these capabilities in a single, progressively disclosed interface:

**Instant auto-slice with AI-assisted sensitivity suggestion.** Slicer classifies input material (percussive, melodic, mixed) and automatically selects the optimal detection algorithm and threshold. Serato Sample's "Autoset" button is the closest analog, but it finds interesting cue points rather than optimizing for clean isolation of musical events. Slicer's "Suggest" targets the specific problem of finding the right number of slices for the material type — a problem every other tool leaves entirely to the user.

**Live sensitivity feedback with protected manual markers.** Combining ReCycle's pioneering real-time slider feedback with Logic's dual-color marker system (auto markers respond to sensitivity; manual/locked markers persist) solves the fundamental tension that has plagued slicers for 30 years: adjusting sensitivity destroys manual refinements. Slicer's implementation makes both automatic and manual workflows composable rather than competing.

**Integrated step sequencer with generative chaos controls.** Most slicers are either instruments without sequencers (Simpler, Quick Sampler, Serato Sample) or sequencers without instrument depth (BreakTweaker). Slicer integrates both. The **Chaos slider** paired with Randomize is a generative composition tool built into the main workflow — not a separate plugin or mode. At 30% chaos, the user gets variations on their pattern; at 100%, entirely new sequences emerge. The undo-randomize-adjust loop is designed as a creative workflow, not just a utility.

**Per-slice output routing and time-stretch algorithm selection.** Slicex pioneered per-slice mixer routing but buried it in an intimidating interface. Slicer brings it to Level 4 with a clean, per-pad output channel selector. Going further, Slicer offers **per-slice time-stretch algorithm selection** — one slice can use Repitch (for pitched-down kicks), another can use WSOLA (for tempo-matched melodic fragments), and a third can use Formant-preserving (for vocal chops). No existing slicer offers per-slice algorithm selection.

**Send-to-Toaster integration.** The ability to transfer individual slices or entire slice sets (with all per-slice settings: pitch, tune, gain, envelope, reverse) to Sourdaw's Toaster drum machine creates a pipeline from exploratory chopping to committed beat building. Right-click a pad, send to Toaster, continue building the kit — a workflow that in competing ecosystems requires manual export, re-import, and re-configuration.

**Five-level progressive disclosure.** No competing slicer offers a coherent progressive disclosure system. ReCycle shows everything at once. Simpler hides depth but caps out quickly. Slicex overwhelms immediately. Slicer's five levels ensure that a first-time user sees only a waveform and pads (Level 1), while a power user has access to transient detection algorithms, FFT parameters, per-slice routing, pattern chaining, and REX2 import (Level 5) — without either user seeing the wrong interface for their needs.

**REX2 import for legacy loop libraries.** Producers have accumulated decades of REX loop libraries. Slicer's Lab-level REX2 import preserves pre-defined slice points, enabling immediate use of existing collections — a practical competitive advantage that respects the user's existing investment.

### The cultural positioning

Slicer is designed to be the tool J Dilla would use if he were producing on a laptop in 2026. It respects the MPC tradition by making pads immediately playable, by implementing Roger Linn's swing algorithm as a first-class control, by supporting unquantized/raw performance alongside quantized sequencing, and by prioritizing the shortest possible path from source material to creative performance. **It is an instrument that happens to edit audio, not an editor that happens to have pads.**

---

## Conclusion

Three design convictions anchor every decision in this specification. First, **the sensitivity slider with live visual feedback is the most important interaction in the entire plugin** — it must be continuous, responsive under 50ms, show slice count, update the waveform in real time, and protect manual work through the dual-marker color system. Second, **progressive disclosure is not optional** — a five-level system that starts with zero configuration and ends with FFT parameters is the only way to serve both the producer who wants to jam immediately and the sound designer who wants per-slice spectral flux detection. Third, **cultural authenticity matters** — the MPC tradition of chopping, flipping, and performing on pads is not a metaphor to approximate but a workflow to genuinely support, complete with Linn-style swing, live pad recording, and the tactile animations that make pads feel like physical instruments rather than buttons on a screen.

The combination of AI-suggested sensitivity, protected manual markers, integrated generative sequencing, per-slice time-stretch selection, and the Toaster pipeline creates a tool that is not just competitive with but meaningfully better than any individual existing slicer. This specification provides everything a UI/UX designer and React 19 developer need to build it.
