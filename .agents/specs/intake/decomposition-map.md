# Decomposition map

Maps every distinct feature/item in the six parked umbrella intakes to a target slug and a
disposition:

- **covered** — an existing/planned slug already owns it (converted elsewhere; no new spec).
- **net-new** — no existing slug owned it; a draft spec was created under `.agents/specs/<slug>/`.
- **deferred-gap** — leftover work/debt on an existing feature; fold into the named owning
  slug's Open questions / ACs during that feature's conversion.

Net-new slugs created from this pass are listed at the bottom.

---

## 1. `intake/differentiators.md` — Real differentiators worth building

| Feature/Item | Target slug | Disposition |
| --- | --- | --- |
| 1. Variation-native clips, takes, and branches | `variation-native-clips` | net-new |
| 2. Unified performance expression model | `performance-expression` | net-new |
| 3. Per-note expressive portability | `expression-portability` | net-new |
| 4. Capture-anything project memory | `capture-inbox` | net-new |
| 5. Explicit trust modes for AI operations | `ai-trust-modes` | net-new |
| 6. Runtime transparency | `runtime-transparency` | net-new |
| 7. Hardware-adaptive session modes | `session-modes` | net-new |
| 8. Capability-aware feature planning | `chrome-first-capability` | covered |
| 9. Negotiated instrument semantics | `instrument-semantics` | net-new |
| Support A. Engine visibility and swappability | `engine-visibility-swap` | net-new |
| Support B. Lightweight goal attachment | `timeline-goals` | net-new |
| Support C. Passive decision memory | `decision-memory` | net-new |
| "What not to overbuild" guardrails | — | non-feature (design guidance; no spec) |

---

## 2. `intake/future-spec.md` — Future-DAW unified specification

| Feature/Item | Target slug | Disposition |
| --- | --- | --- |
| Graph primitive: Intent | `timeline-goals` | covered |
| Graph primitive: PerformanceDNA | `performance-expression` | covered |
| Graph primitive: Variation | `variation-native-clips` | covered |
| Graph primitive: Decision | `decision-memory` | covered |
| Graph primitive: CapabilityDescriptor | `chrome-first-capability` | covered |
| Graph primitive: ProvenanceManifest | `export-provenance` | covered |
| A. Creative intent layer | `timeline-goals` | covered |
| B. Unified performance DNA editing | `performance-expression` | covered |
| C. Variation-native clips and branches | `variation-native-clips` | covered |
| D. Object-based and format-flexible mixing | `atmos` | covered |
| D. Render-target switcher (stereo/binaural/bed/object/ADM) generalization | `atmos` | deferred-gap |
| E. Capture-anything project memory | `capture-inbox` | covered |
| F. Hardware-adaptive session modes | `session-modes` | covered |
| G. Model-and-engine rack | `engine-visibility-swap` | covered |
| H. Negotiated instrument semantics | `instrument-semantics` | covered |
| I. Capabilities graph | `chrome-first-capability` | covered |
| J. Per-note expressive portability | `expression-portability` | covered |
| K. Session memory of decisions | `decision-memory` | covered |
| L. Trust modes for AI operations | `ai-trust-modes` | covered |
| M. Exportable provenance | `export-provenance` | covered |
| N. Multi-resolution sessions (Fidelity Matrix) | `multi-resolution-sessions` | net-new |
| O. Constraint-driven composition | `constraint-composition` | net-new |
| P. Runtime-native transparency | `runtime-transparency` | covered |
| Collaboration model (semantic CRDT, conflict views, attribution) | `collaboration-semantic-crdt` | net-new |
| Cross-feature: canonical internal representation | `performance-expression` | deferred-gap |
| Cross-feature: branch-first generation | `variation-native-clips` | deferred-gap |
| Cross-feature: policy engine | `ai-trust-modes` | deferred-gap |
| Cross-feature: agent interface | `ai-trust-modes` | deferred-gap |
| Browser vs desktop split responsibilities | `chrome-first-capability` | covered |
| Build order / quality bar / agent success criteria | — | non-feature (process; no spec) |

---

## 3. `intake/full-spec.md` — Consolidated spec: unimplemented features & differentiators

| Feature/Item | Target slug | Disposition |
| --- | --- | --- |
| 0. Expression data loss on paste (quick-win bug) | `performance-expression` | deferred-gap |
| 1. Variation-native clips and branches | `variation-native-clips` | covered |
| 2. Runtime transparency strip | `runtime-transparency` | covered |
| 3. Explicit trust modes for AI operations | `ai-trust-modes` | covered |
| 4. Capture-anything project memory | `capture-inbox` | covered |
| 5. Hardware-adaptive session modes | `session-modes` | covered |
| 6. Capability-aware feature planning | `chrome-first-capability` | covered |
| 7. Unified performance expression model | `performance-expression` | covered |
| 8. Negotiated instrument semantics | `instrument-semantics` | covered |
| 9. Lightweight goal attachment | `timeline-goals` | covered |
| 10. Passive decision memory | `decision-memory` | covered |
| 11. MIDI 2.0 / UMP native architecture | `performance-expression` | deferred-gap |
| 12. Integrated mastering page | `mastering-page` | net-new |
| 13. Delivery manager with platform-aware export | `delivery-export-targets` | net-new |
| 14. AI-assisted comping | `ai-comping` | net-new |
| 15. AI UX philosophy — integration patterns | `ai-trust-modes` | deferred-gap |
| 16. Sidechain-aware stem export | `export-encoders-integrity` | deferred-gap |
| 17. Game audio delivery (Wwise/FMOD export) | `game-audio-export` | net-new |
| 18. ML-based transient detection | `ml-onset-detection` | net-new |
| 19. AI warp mode auto-detection | `elastic-audio` | deferred-gap |
| 20. Non-destructive Direct Offline Processing (DOP) | `direct-offline-processing` | net-new |
| 21. Engine visibility, swappability, and A/B comparison | `engine-visibility-swap` | covered |
| 22. Export-oriented provenance | `export-provenance` | net-new |

---

## 4. `intake/implementation-gaps.md` — Consolidated implementation gaps

| Feature/Item | Target slug | Disposition |
| --- | --- | --- |
| 1.1 Master Drum Machine (synth engines, P-locks, slicing) | `drum-machine` | deferred-gap |
| 1.2 Levain orchestral performance intelligence | `levain-multi-instance` | deferred-gap |
| 1.3 Fermenter spectral morphing engine | `fermenter-spectral-warp` | deferred-gap |
| 2. Advanced DSP & analog modeling (ZDF, RC envelopes, MinBLEP/PolyBLEP) | `dsp-library-expansion` | net-new |
| 3.1 Transport & playback sync (ghost playheads) | `collaboration-transport-sync` | net-new |
| 3.2 Media channels & discovery | `collaboration-discovery` | net-new |
| 3.2 Automerge document compaction | `crdt` | deferred-gap |
| 4. Plugin hosting architecture (CLAP, sandboxing, creek) | `plugin-hosting-clap` | net-new |
| 5.1 Integrated stem separation workflow | `workflow-ui` | deferred-gap |
| 5.2 Serious vocal suite (formant harmony, doubler, de-ess) | `knead` | deferred-gap |
| 5.2 Vocal comping UI | `ai-comping` | covered |
| 5.3 Clip aliases & automation clips / variation lanes / groove templates | `variation-native-clips` | deferred-gap |
| 5.4 World-class browser & content system (similarity search, auto-tag) | `sample-library` | deferred-gap |
| 5.5 Deep MPE editing — per-note expression lanes | `performance-expression` | deferred-gap |
| 5.5 Hardware scripting / controller profiles (Push, Launchpad) | `push-integration` | deferred-gap |
| 5.6 Mastering translation workflow (assistant, translation curves, A/B/C) | `mastering-page` | covered |
| 6.1 Articulation maps & keyswitch management | `articulation-maps` | covered |
| 6.2 Project-wide key, scale & microtuning (Scala) | `microtuning-engine` | covered |
| 6.3 ARA-style editing & clip-native deep correction | `clip-pitch-editing` | deferred-gap |
| 6.4 Video, spotting, scoring-to-picture | `scoring` | covered |
| 6.5 Usable notation & lead-sheet layer | `notation` | covered |
| 6.6 Spatial / immersive / Dolby Atmos mixing | `atmos` | covered |
| 7.1 Performance budgets per platform | `performance-budgets-profiling` | net-new |
| 7.2 Profiling methodology | `performance-budgets-profiling` | covered |
| 7.3 EBU R 128 loudness metering | `loudness-metering-ebur128` | net-new |
| 7.4 Peak mipmap pre-computation | `waveform-peak-cache` | net-new |
| 7.5 DAWproject import/export | `dawproject-interchange` | net-new |
| 7.6 Neural Amp Modeler (NAM) integration | `grinder-neural-external-models-phase-8` | covered |
| 7.7 Ableton Link clock sync | `ableton-link-sync` | net-new |
| 7.8a Rust-native stem export & offline bounce | `export-encoders-integrity` | covered |
| 7.8a Offline bounce (freeze/flatten) integration | `freeze-flatten-bounce` | deferred-gap |
| 7.8b Native multi-track recording + step/count-in | `multitrack-recording-workflow` | net-new |
| 7.8c MIDI engine primitives (probability, MPE allocator, MIDI clock) | `midi-engine-primitives` | net-new |
| 7.8c MIDI effects pipeline (arp, velocity, groove) | `yeast` | deferred-gap |
| 7.8d Controller learning | `push-integration` | deferred-gap |
| 7.8d Routing visualization | `node-view` | deferred-gap |
| 7.8 SoundFonts (.sf2) playback | `soundfont-playback` | net-new |
| 8.1 Audio Unit (AU) hosting scope decision | `plugin-hosting-clap` | deferred-gap |
| 8.2 Real-time audio thread priority | `performance-budgets-profiling` | deferred-gap |
| 8.3 FAUST → Rust DSP pipeline | `dsp-library-expansion` | covered |
| 8.3a DSP library completions | `dsp-library-expansion` | covered |
| 8.3b Browser DSP offloading & shared-memory config | `browser-dsp-offload` | net-new |
| 8.3c Offline export encoders and signal integrity | `export-encoders-integrity` | net-new |
| 8.4 SFZ loader | `sample-player-sfz` | covered |
| 9.1 Transport leader model | `collaboration-transport-sync` | covered |
| 9.2 Peer-to-peer monotonic time synchronisation | `collaboration-transport-sync` | covered |
| 9.3 Split-brain detection and guard | `collaboration-transport-sync` | covered |
| 9.4 Host approval UX for role changes | `collaboration-roles-trust` | net-new |
| 9.5 Session-signed role tokens | `collaboration-roles-trust` | covered |
| 9.6 Library reference policies for missing assets | `collaboration-asset-transfer` | net-new |
| 9.6a Advanced discovery modes (DHT / rendezvous / VPN) | `collaboration-discovery` | covered |
| 9.7 Bitmap-chunked asset transfer with resume | `collaboration-asset-transfer` | covered |
| 10.1 MTS-ESP host lifecycle | `mts-esp-host` | net-new |
| 10.2 Lock-free tuning table & triple-buffer delivery | `microtuning-engine` | net-new |
| 10.3 Surge-style microtonal math — public API | `microtuning-engine` | covered |
| 10.4 Adaptive piano roll for arbitrary N-TET | `microtonal-piano-roll` | net-new |
| 10.4a Non-destructive scale folding for key changes | `scale-folding` | net-new |
| 10.5 Scala format support matrix (.scl / .kbm / .ascl) | `scala-tuning-formats` | net-new |

---

## 5. `intake/audit-deferred-fixes.md` — Consolidated audit (deferred fixes)

All items are debt/correctness fixes on existing features; they fold into the named slug's
conversion. Group G's net-new home is the recording/sequencer specs created this pass.

| Feature/Item | Target slug | Disposition |
| --- | --- | --- |
| Group A — Timeline / MIDI editing (ripple, shift/split/scale use cases) | `ripple-delete-ownership` | deferred-gap |
| Group A — PianoRoll active-clip selector | `clip-pitch-editing` | deferred-gap |
| Group B — DSP correctness (limiter deque, LR4 bands, Crumbs anti-alias) | `fermenter` | deferred-gap |
| Group B — Grinder AudioParam policy | `grinder-stabilization-phase-2` | deferred-gap |
| Group C — AI runtime (`invokeLlm` dispatch, AI snapshots) | `audio-generation` | deferred-gap |
| Group C — AI runtime transparency surfacing | `runtime-transparency` | deferred-gap |
| Group D — Audio engine architecture (`EngineDeviceNode`, bypass, PDC) | `plugin-hosting-clap` | deferred-gap |
| Group E — State/persistence (Automerge storage adapters, Fermenter SAB telemetry) | `crdt` | deferred-gap |
| Group F — UI (ChatPanel split, layout) | `design-system` | deferred-gap |
| Group G — Recording (track-level `inputChannelCount`, stereo input) | `multitrack-recording-workflow` | covered |
| Group G — Sequencer sample-accurate `fire()` | `midi-engine-primitives` | covered |
| Native plugin SAB transport (I-01) | `plugin-hosting-clap` | deferred-gap |

---

## 6. `intake/spec-of-the-gaps.md` — Spec of the gaps

| Feature/Item | Target slug | Disposition |
| --- | --- | --- |
| 1.1 Design system token alignment (implemented) | `design-system` | covered |
| 1.2 Layout component migration (implemented) | `layout-components-migration` | covered |
| 2.1 CRDT & persistence | `crdt` | deferred-gap |
| 2.2 Freeze, flatten, & bounce | `freeze-flatten-bounce` | covered |
| 2.3 Audio & platform (stereo recording, native I/O) | `multitrack-recording-workflow` | deferred-gap |
| 3.1 Fermenter (flagship synth) | `fermenter` | deferred-gap |
| 3.2 Knead & clip pitch editing | `knead` | covered |
| 3.3 Drum machine realism | `drum-machine-realism` | covered |
| 3.4 Unified sampler suite | `unified-sampler-suite` | covered |
| 3.5 Piano plugin (Grand Boule) | `piano-plugin` | covered |
| 3.6 Levain orchestral engine | `levain-multi-instance` | covered |
| 4.1 Sample library intelligence | `sample-library` | deferred-gap |
| 4.2 Yeast (MIDI FX) | `yeast` | deferred-gap |

---

## Net-new spec slugs created this pass

Vision / workflow (20): `variation-native-clips`, `performance-expression`,
`expression-portability`, `capture-inbox`, `ai-trust-modes`, `runtime-transparency`,
`session-modes`, `instrument-semantics`, `engine-visibility-swap`, `timeline-goals`,
`decision-memory`, `export-provenance`, `delivery-export-targets`, `game-audio-export`,
`ai-comping`, `ml-onset-detection`, `direct-offline-processing`, `mastering-page`,
`multi-resolution-sessions`, `constraint-composition`.

Infrastructure / DSP / export (12): `plugin-hosting-clap`, `dsp-library-expansion`,
`browser-dsp-offload`, `export-encoders-integrity`, `dawproject-interchange`,
`soundfont-playback`, `performance-budgets-profiling`, `loudness-metering-ebur128`,
`waveform-peak-cache`, `ableton-link-sync`, `multitrack-recording-workflow`,
`midi-engine-primitives`.

Microtuning (5): `microtuning-engine`, `mts-esp-host`, `scala-tuning-formats`,
`microtonal-piano-roll`, `scale-folding`.

Collaboration (5): `collaboration-semantic-crdt`, `collaboration-transport-sync`,
`collaboration-roles-trust`, `collaboration-asset-transfer`, `collaboration-discovery`.

Total net-new: 42.
