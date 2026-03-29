# Knead — Pitch Correction and Melodic Editing Research and Implementation Guide

## Requirements and competitive baselines

Knead’s mission is two different products glued together: a low-latency monophonic corrector for tracking/live feel (Auto‑Tune/Waves‑style), and an offline, note-object editor that can reach into chords (Melodyne DNA‑style). The hard part is not “pitch correction” in the everyday sense; it’s building a representation of _note objects_ inside polyphonic audio so that per-note edits (pitch, timing, duration, formant) can be applied without shredding everything else. citeturn22view0turn22view1turn27view0

**What “DNA-level” implies in practice.** entity["company","Celemony","audio software company, munich"]’s documentation and patent trail are unusually explicit that polyphonic note editing is (a) an STFT-and-object-analysis problem, (b) not guaranteed to be “perfect” for all signals, and (c) fundamentally an _offline_ analysis workflow rather than a live, frame-by-frame corrector. citeturn27view0turn22view1turn39view0 The core patent language describes: overlapping-window readout, Fourier transform, energy-per-bin, event objects, note objects, associating events to notes by time plausibility, and computing per-note “spectral proportion factors” so a portion of the total sound can be attributed to each note object (and later resynthesized after edits). citeturn22view0turn22view1 That same publication frames the goal as discriminating _pitches / pitch evolutions_ in the overall signal (and associating sound portions to “note objects”), explicitly distinguishing this from general “separate all sources in a room” source separation. citeturn22view1

**Melodyne’s algorithm split is a useful mental model for Knead.** Melodyne exposes distinct analysis modes and recommends them per material: “Melodic” for monophonic pitched signals (vocal, flute, bass), “Percussive” variants for transient material, “Polyphonic Sustain/Decay” for chord-capable instruments when you need per-note access, and “Universal” when you just need time-slice stretching/transposition for complex material like rhythm guitars or mixes. citeturn27view0turn27view1 Importantly, Celemony warns that polyphonic detection “cannot…always deliver perfect results” and urges a workflow where users _check and correct_ detection in a note-assignment mode. citeturn27view0 That is a direct UI/UX requirement for Knead: a polyphonic “Lab” mode that assumes imperfect analysis and equips the user to repair it.

**Real-time pitch correction tools define the “Play” layer of UX.** entity["company","Antares Audio Technologies","audio software company, ca, us"]’s Auto‑Tune Pro X user guide clearly positions “Auto Mode” as low-latency real-time pitch correction and “Graph Mode” as detailed pitch/timing editing. citeturn14view1 It also states a hard constraint: Auto‑Tune is intended for a well-isolated **monophonic** source and cannot accurately pitch-correct multiple pitches at once (multiple voices on one track, chords, etc.). citeturn14view1 The guide defines **Retune Speed** as the rate of correction, including a **0 ms** setting that produces instantaneous pitch changes (the signature hard-quantized behavior). citeturn21view0 It further defines **Humanize** as a mechanism to apply slower retune only on the sustained part of longer notes to avoid sustained notes becoming unnaturally static when fast retune is needed for short notes. citeturn21view1

**Waves Tune Real-Time is a clean spec for “speed/tolerance/vibrato” behavior.** entity["company","Waves Audio","audio dsp company, tel aviv"]’ documentation defines correction **Speed** (ms) and **Note Transition** (ms) separately, and explicitly introduces **Tolerance** as “Cents” and “Time” thresholds to prevent unwanted note-hopping glitches. citeturn40view0turn10view2 It specifies a base behavior where changing target note is tied to a 50‑cent threshold (Western scales) and shows how “Cents” adds to that threshold and “Time” adds a dwell-time requirement before correction kicks in. citeturn40view1turn10view2 It also separates “vibrato depth” (preserve/diminish/exaggerate frequency modulation) from correction speed, and describes a “quantization effect” approach through fast speed/transition and reduced vibrato depth. citeturn40view0

**Performance transfer and alignment are not optional features if you want “suite-level” value.** entity["company","Synchro Arts","audio software company, uk"]’ Revoice Pro describes Audio Performance Transfer (APT) as (1) finding timing correspondence between a Guide and a Target (Dub) using VocAlign technology, then (2) measuring features like timing, pitch, vibrato, and level, then (3) transferring user-selected features to generate a modified target, usually with timing alignment. citeturn25view0 This “guide/dub” conceptual model maps cleanly onto Knead’s “Route” layer: alignment + pitch transfer between tracks as first-class operations.

**Integrated editors show what users expect from “blobs.”** entity["company","Apple","technology company, cupertino"]’s Logic Pro Flex Pitch documentation demonstrates the baseline interaction model: notes can be dragged vertically to change pitch, horizontally to move timing, edges resized for duration, notes can be split/merged, and per-note “hotspots” expose pitch drift (start/end), vibrato, fine pitch, gain, and formant shift. citeturn25view1 This is a ready-made blueprint for Knead’s Level 3 editor interactions.

**Formant preservation is repeatedly treated as core quality.** entity["company","iZotope","audio software company, ma, us"]’s Nectar pitch correction documentation describes “Preserve” formant controls that retain the original vocal timbre while pitch is corrected, plus explicit formant shift controls and guidance that singers’ formants often shift slightly with pitch in natural production. citeturn25view2 Celemony exposes a dedicated formant tool with per-note formant shifts measured in cents and large-range creative shifts, reinforcing that “pitch vs formant” must be independently editable at the note-object level. citeturn25view5

The upshot: Knead needs a **dual engine** strategy—real-time monophonic processing for “Play/Shape,” and offline analysis + note-object resynthesis for “Build/Lab.” That division is consistent with how DNA-like systems and real-time correctors publicly describe their constraints and workflows. citeturn22view1turn14view1turn43view2

## Monophonic analysis: detection, voicing, notes, vibrato

Monophonic pitch detection is the “easy” part only relative to polyphonic note access—it is still hard to make robust against breathiness, consonants, vibrato, and fast transitions. A production-grade monophonic analysis pipeline should output: a frame-level f0 estimate (or “unvoiced”), a confidence/aperiodicity measure, and a smoothed pitch curve plus discrete note objects.

**YIN as the baseline estimator.** A clear, implementable description of YIN is captured in the docs for a Rust YIN implementation: compute the mean-square difference function \(d(t)\), normalize it via the cumulative mean normalized difference function \(d'(t)\), then choose the first local minimum below a threshold; refine via quadratic (parabolic) interpolation. citeturn20view0 The aubio documentation similarly traces YIN’s lineage and highlights tolerance thresholds and confidence concepts in practical pitch detectors derived from YIN (including FFT-based variants that compute a tapered difference function). citeturn20view1

**pYIN as “YIN + probabilities + sequence model.”** A very usable production definition appears in the librosa documentation: pYIN computes multiple f0 candidates and associated probabilities from YIN-style analysis, then applies **Viterbi decoding** to estimate the most likely f0 sequence and voicing flags. citeturn19view0turn18search2 This is exactly the smoothing behavior needed to reduce octave jumps and stabilize voiced/unvoiced boundaries under vibrato and portamento.

**Frame sizes and hops should be chosen around latency vs stability tradeoffs.** Librosa’s pYIN defaults (frame_length 2048 samples, hop_length ≈ frame_length/4) are a concrete, widely-used reference point and imply an analysis overlap near 75%. citeturn19view0 For Knead’s real-time mode, you can treat this as a starting “analysis resolution” rather than a fixed rule: smaller frames reduce latency but lose low-frequency resolution, while larger frames improve stability and low-note tracking at the cost of responsiveness.

**Voiced/unvoiced (and “what not to tune”).** pYIN’s model explicitly outputs voiced flags and voiced probabilities, which you can treat as the primary gate for pitch correction. citeturn19view0 Celemony’s vocal-oriented workflow adds an important practical insight: sibilants are detected and treated specially, and pitch correction tools preserve sound quality by transposing _pitched components_ without shifting sibilants (since shifting sibilants sounds unnatural). citeturn26view0turn27view0 For Knead, that suggests a monophonic analysis that tags frames (or subframes) as “periodic tonal,” “noise-like,” and “transient,” and routes them differently through the correction engine.

**From pitch curve to note objects.** In Melodyne terms, “blobs” are not frames—they are note objects that have pitch center, drift, modulation/vibrato, and transitions. Celemony’s pitch editing descriptions explicitly separate pitch center from modulation and drift, describing pitch drift as slow wavering while preserving faster modulation (vibrato). citeturn26view1turn26view0 Logic’s Flex Pitch similarly treats drift and vibrato as separate edit dimensions per note. citeturn25view1 In Knead, note segmentation should therefore be optimized for _editability_: you want note boundaries where users expect separate musical notes or separable regions of expression (e.g., a slide into a note vs the steady-state vowel).

**Vibrato detection should be explicit, not an accidental byproduct.** Empirical voice research frequently characterizes vocal vibrato as periodic modulation of f0, commonly in the **4–7 Hz** range, with extent reported in cents or percent depending on study. citeturn24view4turn24view1turn24view15 A practical representation for Knead is:

- a **baseline pitch curve** (slow component: intended pitch + portamento),
- plus a **modulation component** (band-limited around vibrato rates),
- plus optional micro-jitter/noise descriptors for breathiness.

This matches the control affordances users see in Auto‑Tune (Humanize), Waves (Vibrato Depth), Melodyne (pitch modulation/drift separation), and Flex Pitch (vibrato tool/hotspot). citeturn21view1turn40view0turn26view1turn25view1

## Real-time correction and time-scale manipulation

Knead’s real-time mode should behave like a musician-friendly “set key/scale and sing/play” device—but under the hood it needs a mathematically stable target selection rule, a correction-rate model, and a low-latency pitch shifter suitable for monophonic voiced signals.

**Target pitch selection is a constrained mapping problem, not a “nearest bin” toy.** The basic behavior across mainstream correctors is: pick allowed notes from a key/scale system and tune toward them. Auto‑Tune’s guide describes continuous comparison to scale notes and correction to the nearest scale tone under fast retune settings. citeturn21view0turn14view1 iZotope and VocalSynth documentation similarly emphasizes correctly choosing root/scale (or going chromatic when unsure) to get robust results. citeturn25view2turn10view3

**Speed, tolerance, and “humanize” are separate controls with distinct DSP implications.**

- **Retune speed / correction speed** is the time constant of a smoothing process toward the target pitch. Auto‑Tune is explicit that 0 ms is instantaneous, and larger values produce more gradual pitch changes. citeturn21view0 Waves expresses this as a Speed parameter in ms, noting that fast values can flatten pitch contours. citeturn40view0
- **Tolerance / flex** is a hysteresis mechanism that prevents micro-variations from triggering a different target note. Waves’ “Cents” and “Time” tolerance parameters are a precise specification of this idea. citeturn40view1turn10view2 Auto‑Tune’s “Flex‑Tune” similarly narrows or widens the effective correction zone around scale notes. citeturn21view2
- **Humanize / vibrato preservation** should operate primarily on the sustained segment of a note, slowing correction there while still allowing fast capture of short notes. Auto‑Tune defines Humanize exactly in these terms. citeturn21view1 Waves’ vibrato model explicitly treats frequency modulation preservation separately from correction speed. citeturn40view0

A practical Knead design is to compute a **note target** plus a **continuous correction curve** that depends on: current deviation, voicing probability, whether the segment is “attack vs sustain,” and whether modulation is labeled as vibrato vs unintended drift.

**PSOLA is the primary real-time monophonic pitch shifter for “natural” small moves.** The classic PSOLA framework is described by entity["people","Eric Moulines","speech dsp researcher"] and entity["people","Francis Charpentier","speech dsp researcher"] as a pitch-synchronous overlap-add approach for prosody modification, with variants operating in time domain (TD‑PSOLA) and frequency domain (FD‑PSOLA); the paper explicitly notes time-domain PSOLA’s efficiency for real-time systems, while FD‑PSOLA provides more flexible spectral modification. citeturn31view0 For Knead’s “Play” layer, TD‑PSOLA-style processing aligned to pitch marks (or robust quasi-period markers) is the lowest-latency path to natural sound on vocals and single melodic instruments—provided voicing detection and period tracking are stable.

**Phase vocoder is the fallback for larger shifts, polyphonic material, and harmonizer voices.** entity["people","Jean Laroche","audio dsp researcher"] and entity["people","Mark Dolson","audio dsp researcher"] describe phase-vocoder techniques for pitch shifting and harmonizing, including peak-detection and peak-shifting stages and a tradeoff where more flexible techniques require larger overlap (they explicitly contrast a simple 50% overlap case with a more flexible approach requiring ~75% overlap). citeturn10view4turn40view0 This maps directly to a practical Knead architecture:

- Use PSOLA where you have strong periodicity and need low latency.
- Use a peak/phase-locked vocoder family where periodicity is weak or polyphony exists, accepting heavier compute and managing transient artifacts.

**Transient handling is not optional; it gates perceived “pro quality.”** entity["people","Axel Röbel","audio dsp researcher"]’s phase vocoder transient work is explicit about the failure mode: abrupt amplitude changes (attack transients) violate near-stationary assumptions and cause characteristic artifacts. citeturn36view0 The paper proposes transient detection and processing at the level of spectral peaks/bins, with phase reinitialization timed around transient position, aiming to keep stationary partials coherent even in polyphonic signals. citeturn36view0 For Knead, this implies the real-time pitch shifter must include:

- a transient detector (energy/phase-related features),
- an option to bypass or special-handle transients,
- and a “transient-safety” mode for percussive onsets in instruments like guitar or piano.

## Formant modeling and timbral control

Pitch correction that “sounds expensive” is usually less about pitch accuracy and more about preserving or intentionally manipulating timbre. Every major baseline tool exposes formant operations, either as “preserve” or as “shift.”

**Source–filter framing and LPC are the pragmatic entry point.** entity["people","John Makhoul","speech dsp researcher"]’s classic tutorial describes linear prediction as modeling a signal via an all-pole filter excited by a source (impulse train for voiced, noise for unvoiced), which is the operational basis for extracting a spectral envelope in speech-like signals. citeturn8search0turn37view0 (For vocals, this envelope corresponds closely to formant structure and broader timbral shaping.) Order selection is a long-standing practical issue; Matlab’s formant estimation documentation gives a standard rule of thumb relating model order to expected formant count. citeturn8search1

**Formant preservation is an explicit product requirement in commercial tools.**

- Nectar describes “Preserve” formants as retaining the performer’s timbre while tuning, and provides per-region formant shift and scaling controls. citeturn25view2
- Celemony’s formant tool describes per-note formant shifts with visual feedback measured in cents (100 cents = 1 semitone), emphasizing that formants can be moved independently of pitch for subtle nuance or extreme effects. citeturn25view5
- Logic Flex Pitch exposes per-note formant shift directly in the editor. citeturn25view1

**Implementation implications for Knead.**

- In PSOLA-based monophonic shifting, small pitch moves often preserve perceived formants reasonably well because the waveform’s fine structure is preserved under pitch-synchronous overlap-add—until you push into large transpositions or unstable pitch-marking.
- In FFT/phase-vocoder methods, pitch shifting naively moves the entire spectrum, which shifts both the harmonic structure and the spectral envelope together—hence the “chipmunk/monster” effect. This is why formant-aware processing tends to decompose **envelope vs excitation** (via LPC, cepstral “true envelope” families, or related methods) and recompose after shifting.

Because Knead must support both “preserve” and “creative formant shift,” the internal representation should store (at minimum) a per-note spectral envelope descriptor and a policy:

- **Preserve**: keep envelope mostly fixed while shifting harmonic structure.
- **Follow**: shift envelope partially with pitch (as Nectar notes is closer to what humans do). citeturn25view2
- **Independent shift**: shift envelope without shifting pitch (gender shift), or vice versa.

## Polyphonic note access: analysis, separation, resynthesis

This is the defining challenge: providing edit handles for individual notes _inside chords_ in a rendered audio file. The central risk is believing this is “just polyphonic pitch detection.” It is more than that: you need a decomposition that is stable under editing and resynthesis.

**Why this remains hard (and what success looks like).** Multi‑f0 estimation and polyphonic analysis remain challenging and do not match human ability, especially as polyphony increases and sources become spectrally dense. citeturn38view0turn31view3 Duan/Pardo/Zhang explicitly frame multi‑f0 estimation as challenging and motivate peak-based spectral representations because peaks carry perceptually salient harmonic information and facilitate modeling of multiples of fundamentals. citeturn38view0 Virtanen’s NMF work similarly frames monaural polyphonic separation as a difficult problem, modeling mixtures via nonnegative spectrogram factorization and emphasizing that “sound source separation” from a single channel is an appealing but hard capability. citeturn31view3

**DNA-style analysis is best viewed as “note objects + masks,” not “stems.”** The Celemony patent family frames polyphonic editing as identifying **note objects** (quasi-periodic pitched objects with perceptible duration), associating lower-level **event objects** to them, and computing **spectral proportion factors** that assign portions of the total spectral energy to each note object for later processing and resynthesis. citeturn22view0turn22view1 It also explicitly positions the method as primarily for already-recorded musical material, not real-time performance processing. citeturn22view1 This supports Knead’s required product stance: polyphonic “Lab” mode should be an offline analysis pass with caching and user-driven verification/correction tools.

**A workable hybrid pipeline for Knead’s polyphonic mode.** The most defensible route is a hybrid of classic sinusoidal modeling (for editability and high-quality resynthesis) plus modern multipitch priors (for initialization and robustness).

1. **STFT + peak picking + partial tracking (sinusoidal front end).** A standard sinusoidal model extracts peaks from the STFT and then tracks sinusoids over time. entity["people","Robert McAulay","speech dsp researcher"] and entity["people","Thomas Quatieri","speech dsp researcher"] describe extracting amplitudes/frequencies/phases via STFT peak picking and tracking peaks across frames with “birth” and “death” of sinusoids, with explicit attention to phase trajectory smoothing for high-quality reconstruction. citeturn37view0 The PARSHL framework (by entity["people","Julius O. Smith","audio dsp researcher"] and entity["people","Xavier Serra","audio dsp researcher"]) similarly describes STFT-based peak tracking that follows amplitude, frequency, and phase trajectories from FFT to FFT, framing it as an “inharmonic phase vocoder” suitable for additive parameter extraction. citeturn32view1turn32view2

2. **Harmonic grouping and multi‑f0 inference (note hypothesis).** Once you have partial tracks, you need to group them into harmonic sets that correspond to note objects. Duan/Pardo’s maximum-likelihood multi‑f0 estimation models both spectral peaks and non-peak regions and uses greedy/iterative strategies to avoid combinatorial explosion, plus refinement over neighboring frames to reduce inconsistent errors. citeturn38view0 This family of ideas is directly useful for Knead: multi‑f0 should propose candidate fundamentals; harmonic grouping assigns tracked partials to fundamentals; then note objects are formed by temporal continuity of activation.

3. **Event objects, note objects, and per-note masks (editability layer).** The Celemony patent’s “event objects → note objects → spectral proportion factors” structure is effectively an instruction to compute **soft masks**: per note object, determine how much of each time-frequency bin belongs to it, enabling removal/addition/resynthesis after edits. citeturn22view0turn22view1 This avoids hard separation boundaries and supports gradual overlap between notes—critical when harmonics collide.

4. **Residual modeling (what you don’t want to warp).** Sinusoidal modeling literature and practical tools often conceptualize signals as deterministic sinusoidal components plus residual/noise/transients. Dressler’s DAFx work on sinusoidal extraction explicitly motivates dividing the signal into deterministic sinusoidal components plus noise and notes that polyphonic audio demands adaptations beyond monophonic assumptions. citeturn31view4 For Knead, the residual should be preserved or separately processed (especially for transients and noise-like components), aligned with the Melodyne approach of protecting sibilants/unpitched components during pitch correction. citeturn26view0turn27view0

5. **Resynthesis under edits with phase coherence constraints.** High-quality resynthesis requires continuity of phase trajectories and careful handling at note boundaries. McAulay/Quatieri explicitly emphasize phase trajectory modeling for high-quality reconstruction. citeturn37view0 Röbel’s transient work highlights that careless phase reinitialization across broad bands can destroy coherence of stationary partials in polyphonic signals, motivating localized, bin/peak-level transient treatment. citeturn36view0

**Alternative decomposition approaches and where they fit.**

- **NMF family:** Virtanen’s approach factorizes a magnitude spectrogram into fixed spectra with time-varying gains, encouraging temporal continuity and sparseness; this is valuable as a coarse separation prior but is not inherently “note-object editable” without additional constraints and pitch-aware structure. citeturn31view3
- **PLCA family:** entity["people","Paris Smaragdis","audio ml researcher"] and entity["people","Bhiksha Raj","audio ml researcher"] describe PLCA as a probabilistic latent decomposition of spectra and later extend it toward shift-invariant variants, explicitly relating it to NMF while adding probabilistic interpretability and extensions like shift invariance. citeturn38view1turn38view2 PLCA variants are frequently used for multipitch estimation and can form part of a “note activation posterior” stage, but high-quality per-note pitch/time edits still tend to need sinusoidal/phase-coherent resynthesis or very carefully constrained spectral modification.

- **Neural multipitch / AMT as a prior:** entity["company","Spotify","music streaming company, se"]’s Basic Pitch is a direct demonstration of practical polyphonic note inference from audio: it is described as polyphonic, instrument-agnostic, and capable of pitch-bend detection, with engineering claims of being computationally lightweight and running faster than real time on many computers. citeturn28view0turn28view3turn28view1 The accompanying paper describes a lightweight model that predicts multipitch and note activations and explicitly treats multipitch estimation as preserving expressive pitch fluctuations (vibrato, glissando) while note estimation is closer to a score representation. citeturn29view0 This is highly relevant to Knead as a _hybrid initializer_: neural models can propose “what notes are present when,” while sinusoidal modeling refines f0 and enables high-quality controlled edits.

**Practical limitation envelope for Knead’s “DNA mode.”** External reviews and user discussions align strongly with the technical constraints above: DNA-style editing works best when notes are well separated (e.g., guitar/piano/strings loops) and becomes difficult on heavily distorted material with dense harmonics, producing many tiny ambiguous segments. citeturn43view1turn27view0 Even Celemony’s own docs caution that polyphonic detection cannot always be perfect and suggest manual correction workflows. citeturn27view0 Knead’s product spec should therefore define a “supported polyphonic complexity” band (e.g., sparse polyphony, one primary instrument, moderate distortion) and offer graceful degradation: fall back to time-slice (“Universal”-like) processing and whole-chord transposition when per-note access is unreliable. citeturn27view0turn28view1

**Patent/IP reality check.** The key DNA-like method described in US8022286B2 is listed as active with an expiration shown on the Google Patents page in 2029. citeturn22view0 While this is not legal advice, it is a product-planning constraint: Knead’s design should be careful about literally re-implementing patented claim language (note objects + spectral proportion factors + specific association mechanics) and should involve counsel when engineering approaches converge on patented methods.

## Editor data model, UI/UX, and creative workflow features

Knead’s UI goal (“blob editor is the most important view”) is consistent with how leading tools operationalize note-object editing, and there are concrete interaction patterns worth copying—because they’re grounded in what the underlying DSP can reliably support.

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Melodyne 5 note editor blobs screenshot","Logic Pro Flex Pitch audio track editor screenshot","Auto-Tune Pro X graph mode screenshot","Waves Tune Real-Time plugin interface screenshot"],"num_per_query":1}

**Blob = editable note object.** Melodyne’s documentation explicitly frames blobs as handles for pitch/time edits; its pitch tool text stresses the pitch curve within the blob as essential to perceived intonation and describes musically-informed pitch assessment over the note’s duration. citeturn26view0 Melodyne’s polyphonic mode stacks blobs vertically for chords, and (in versions that support it) allows changing one chord tone to reharmonize the chord (e.g., E minor to E major by changing G to G#). citeturn25view3 Logic Pro Flex Pitch uses very similar note rectangles with direct manipulation and per-note hotspots; that’s a proven UX schema for Level 3. citeturn25view1

**Note separation / split-merge tools are essential, not “advanced.”** Celemony’s training docs distinguish soft separations (linked notes that preserve phrasing and transitions) from hard separations (independent notes with no pitch/formant/amplitude transitions). citeturn25view4turn26view0 Logic Flex Pitch directly supports split and merge operations. citeturn25view1 In Knead, split/merge is not merely an edit convenience: it is the user-facing mechanism to repair segmentation errors and to control transition artifacts.

**A recommended internal data model for Knead’s editor.** To support Level 3+ interactions, each note object should carry:

- time domain: onset, offset, and optional internal anchor points for drift/transitions,
- pitch domain: pitch center (cents), pitch curve (f0 samples), drift curve (low-frequency component), modulation curve (vibrato component),
- timbre domain: formant shift value + optional envelope descriptor snapshot(s),
- amplitude domain: per-note gain and optional amplitude envelope,
- linkage domain: soft/hard separation links to neighbors plus transition parameters,
- provenance: detection confidence, voicing probability, and “analysis mode” used.

For Level 5 DNA-mode notes, extend the note object with:

- partial-track references (amplitude/frequency/phase trajectories),
- per-bin soft masks / spectral proportion factors (for reconstruction under overlap),
- and residual association policy (what is preserved vs transformed).

This structure is aligned with the object vocabulary described in the polyphonic patent and sinusoidal modeling literature (tracked amplitude/frequency/phase trajectories plus birth/death; note objects and per-note spectral allocation). citeturn22view0turn37view0turn32view1

**Progressive disclosure UX mapped to DSP reality.**

- **Play:** A tuner-like view with key/scale, a “correction speed” macro, and wet/dry. This is the Auto‑Tune/Waves mental model. citeturn14view1turn40view0turn10view3
- **Shape:** Expose Humanize, tolerance/flex, vibrato handling, and formant preserve/shift. These correspond to documented controls in Auto‑Tune, Waves, and Nectar. citeturn21view1turn40view1turn25view2
- **Build:** Full-screen piano-roll-like blob editor: drag pitch/time, resize duration, split/merge, per-note drift/vibrato/formant/gain hotspots. Logic Flex Pitch provides a validated interaction spec here. citeturn25view1turn25view4
- **Route:** APT-style guide/dub alignment and pitch transfer; harmonizer where additional voices derive from the same pitch-shift engine but respect scale/key; vocal doubler. Revoice Pro’s APT steps are an explicit design reference. citeturn25view0
- **Lab:** Polyphonic note access with transparent uncertainty (confidence overlays, ambiguous-note highlighting) and manual reassignment tools, consistent with Celemony’s guidance to correct polyphonic detection outputs. citeturn27view0turn22view1

**Creative effects as structured re-use of core primitives.**

- **Hard tune / robotic quantization** is “fast retune + low tolerance + reduced vibrato.” That mapping is directly described in Auto‑Tune (0 ms retune) and Waves (minimum speed/transition, vibrato control). citeturn21view0turn40view0
- **Harmonizer** is multiple shifted voices plus scale-aware target selection. Laroche/Dolson explicitly discuss harmonizing as a phase‑vocoder application, and Basic Pitch’s “multipitch + pitch bend preservation” highlights the importance of expressive variations for realistic harmonies. citeturn10view4turn28view0
- **Vocal doubler** is slight detune + micro-delay + small formant/character variation. Celemony even exposes “random deviations” workflows for simulating doubled tracks more realistically. citeturn26view0
- **Gender shift** is primarily formant shifting without pitch shifting; Nectar and Melodyne both frame formant shift as a first-class control. citeturn25view2turn25view5
- **Pitch-to-MIDI** can be implemented at two levels:
    - monophonic: segment notes from your f0 curve and emit MIDI,
    - polyphonic: use a neural AMT prior like Basic Pitch to infer note events with pitch bends, then export MIDI. citeturn28view0turn28view1turn29view0

**The “secret sauce” is mostly about what you _don’t_ destroy.**

- Preserving vibrato and expressive modulation while correcting pitch center is explicitly how Melodyne separates pitch drift from pitch modulation, and how Auto‑Tune defines Humanize. citeturn26view1turn21view1
- Avoiding note-transition glitches requires tolerance/hysteresis; Waves documents this as the primary purpose of its tolerance controls. citeturn40view1
- Avoiding transient smearing and phase incoherence requires transient-aware phase processing; Röbel’s work is a direct technical blueprint for why and how. citeturn36view0turn10view4
- Polyphonic editability requires an object model robust under overlap; Celemony’s patent language (note objects + spectral proportion factors + residual) and the sinusoidal tracking literature converge on this requirement from different angles. citeturn22view0turn37view0turn32view1

**Honest boundary of what’s achievable.** A “full mix” with drums, bass, guitars, vocals, and effects is generally outside the reliable per-note-edit envelope for today’s non-stem workflows; even DNA-style systems and reviews treat results as case-by-case and dependent on note separability and harmonic clarity. citeturn27view0turn43view1turn28view1 Knead can still be “Melodyne-level” by matching the _workflow contract_: offline polyphonic analysis on suitable material, explicit uncertainty, strong manual correction tools, and excellent monophonic correction—while providing graceful degradation (whole-signal transposition/time-slicing) when note-object separation is unreliable. citeturn27view1turn22view1turn43view2
