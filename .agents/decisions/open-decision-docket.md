---
type: decision-docket
status: open
date: 2026-07-16
---

# Open-decision docket

Genuinely open product/architecture decisions that an agent cannot settle
unilaterally. Promoted from `.agents/findings/inventory-decisions-backlog.md`
(2026-06-19 inventory triage, since retired) and
`.agents/findings/overview-open-decisions.md` (also retired), with citations
re-verified against `main` on 2026-07-16. Decisions already made are **not**
here — they are ADRs (0006 contract-folder barrels, 0007 command relocation,
0008 recent-projects Option A, 0009 pattern-morph determinism).

Item format: decision statement · options/tradeoff · blocks code work? ·
source citation.

## Cross-cutting: finish-or-remove subsystem calls

- **Unbuilt-feature build-vs-remove calls are owned by the audit-deferrals
  table** — SoundLibrary (ownership vs SampleLibrary, 14/15 dead use cases,
  ship-vs-scaffolding), SampleLibrary embedding/Find-Similar, CrdtDocument
  native Tauri backend + `.sdaw` import, GrandBoule sampled-attack, Toaster
  16-Levels/Note-Repeat/Sound-Locks, Automation linked-lanes/envelope
  modulator, Bacteria Lab editors/ModulationDock drag-to-assign, Scoring
  PolyDisplay, Crumbs metering read-back/Warp-Mod-XY/automation-routing, plus
  Extension, DDSP, RAVE, WAM, Push, MIDI hardware mappings, Collaboration
  transport-permission scaffold, Yeast introspection UI, Synth CV/Gate UI.
  Do not restate them here; make each ship-or-retire call against that table.
  Blocks code: no (they are dormant). Source:
  `.agents/findings/audit-remediation-deferrals.md` ("Unbuilt feature
  subsystems — finish-or-remove" table; file is gitignored, main checkout).

## Infra / store

- **Cross-store durability limit: are multi-store Automerge writes allowed to
  be non-atomic?** `batchStoreUpdates()` defers notifications only; a
  multi-store write that fails midway persists a partial cross-store state.
  Options: build a multi-key CRDT transaction vs document and accept the risk.
  Blocks code: no, but gates any feature relying on cross-store invariants.
  Source: `src/infra/store/createStore.ts:35-45`.

## Dependency-cruiser / lint governance

- **Narrow the `no-orphans` blanket exclusion of `/models/`, `/events/`, and
  `types.ts`.** Today an entirely dead model/event file can never be flagged.
  Options: rescope the pathNot vs keep the exclusion; narrowing will surface a
  dead-code backlog that then needs triage. Blocks code: no. Source:
  `.dependency-cruiser.cjs:880-889`.
- **Promote `sourdaw/no-multiple-function-exports` warn → error.** Precedent:
  PR #172 promoted `no-repository-usecase-import` the same way. Measure the
  current warn count first; a large count means a burn-down, not a flip.
  Blocks code: no. Source: `eslint.config.mjs:2556`.
- **Promote `sourdaw/no-model-layer-upward-import` warn → error.** Currently
  zero live matches, so the flip should be free — confirm and promote, or
  record why it must stay warn. Blocks code: no. Source:
  `eslint.config.mjs:2555`.
- **jsx-runtime residual laundering risk: is a two-pattern react match worth
  it?** The react leak rule deliberately matches only `/react/index`, ignoring
  the compiler-injected `react/jsx-runtime`; a genuine JSX leak through a
  non-presentation file is invisible. Options: accept the documented tradeoff
  vs add a second pattern with an allowlist for the 413 compiler artifacts.
  Blocks code: no. Source: `.dependency-cruiser.cjs:668-677` (comment block).
- **No rule catches a `stores/` file that is really a use case.** Live
  instance: `duplicateClipNotes` reads/transforms/writes midiStore from
  `stores/`. Options: design a structural rule (store files export only
  store + selectors) vs one-off relocation of the known instance. Blocks
  code: no. Source: `src/modules/MIDI/stores/duplicateClipNotes.ts:5`,
  exported via `src/modules/MIDI/stores/index.ts`.

## Transport

- **Store persistence contract: which Transport sub-stores are project truth?**
  `transportStore.toCrdt` is a hand-maintained projection with no compile-time
  guard; setlist/loopStation/punchRecording stores use bare `createStore`, so
  their state is lost on save/load. Options: wire them into Automerge vs
  declare them session-scoped. Blocks code: yes, for any setlist/loop/punch
  persistence work. Source: `src/modules/Transport/stores/transportStore.ts`,
  `setlistStore.ts`, `loopStationStore.ts`, `punchRecordingStore.ts`.
- **Canonical BPM bounds.** `setTempo` throws outside 20..300,
  `createTempoChange` clamps 20..999, `addTempoChange`'s update path applies no
  clamp. Options: one shared MIN/MAX constant vs per-path bounds by design.
  Blocks code: yes, for tempo-map edits. Source:
  `src/modules/Transport/useCases/setTempo.ts`, `models/TempoMap.ts`,
  `useCases/tempoMap/addTempoChange.ts`.
- **Two coexisting punch systems — by design or to converge?** The scheduler
  drives real punch-in/out from transportStore fields
  (`punchInEnabled`/`punchInBeat`/`punchOutBeat`, persisted in ProjectData),
  while the separately shipped background-capture model (punchRecordingStore +
  `PunchRecordingControls`, rendered in TransportBar) is UI-wired — its nine
  use cases write capture/region state only, with no audio-capture path behind
  `startBackgroundCapture`/`commitPunchRegion`. Decide whether the two are
  distinct features (auto-punch vs retroactive punch-from-capture, the latter
  still needing engine wiring) or should converge on one model. Blocks code:
  yes, for punch feature work. Source:
  `src/modules/Transport/useCases/playheadScheduler.ts:281-323` (transportStore
  punch), `useCases/punchRecording/startBackgroundCapture.ts` (state-only),
  `presentations/views/PunchRecordingControls.tsx` (mounted at
  `src/modules/Workspace/presentations/views/TransportBar.tsx:133`).
- **Setlist–transport coordination contract.** `goToItem` only sets
  currentIndex and emits a programChange; no seek/tempo/timesig/project load;
  autoAdvance/countInBars/gapSeconds are read by nothing. Options: specify the
  live-set behavior vs park the feature. Blocks code: yes, for setlist work.
  Source: `src/modules/Transport/useCases/setlist/goToItem.ts:11-31`.
- **loopStation layers are placeholders** (no audio capture wired). Options:
  spec the looper capture path vs remove the placeholder records. Blocks code:
  no. Source: `src/modules/Transport/useCases/loopStation/toggleRecord.ts`.
- **detectProjectTempo is stub-grade** — it re-detects the input tempo (one
  synthetic onset per beat at project tempo). Options: real onset detection vs
  remove the affordance. Blocks code: no. Source:
  `src/modules/Transport/useCases/tempoMapping/operations/detectProjectTempo.ts`.

## Command

- **Retire or keep `models/AppAction.ts`.** After ADR 0007 the dispatch
  contract lives in `models/AppAction.ts` (type-imported repo-wide, mirrored by
  AiRuntime); whether it should be retired in favor of the registry/query
  surface is open, as is whether undo-tree branch switching should
  traverse/replay or stay bookkeeping. Options: keep AppAction as canonical
  contract vs migrate consumers. Blocks code: no, but shapes every new action.
  Source: `src/modules/Command/models/AppAction.ts`,
  `useCases/undoTree/branchOperations/switchBranch.ts`; ADR 0007.
- **Canvas-editor Delete routing for non-focusable editors.** The
  `data-canvas-editor` gate works for PianoRoll (focusable canvas) but cannot
  reach the Elastic editor (window-level keydown, non-focusable canvas — its
  Delete double-fires with global clip-delete) and would regress the Mixer
  (no local Delete). Options: editor-local `stopImmediatePropagation` vs an
  "editor-open" flag in the contract; confirm whether Mixer focus should
  swallow clip-delete at all. Blocks code: yes, for the Elastic double-fire
  fix. Source:
  `src/modules/Command/presentations/views/keyboardShortcutsContract.ts`,
  `src/modules/AudioEngine/presentations/views/ElasticEditorPanel.tsx:113-139`,
  `src/modules/Workspace/presentations/views/MixerPanel.tsx`.
- **Themed rename-prompt mechanism (product/UI).** Palette track/clip rename
  still uses native `window.prompt`; no reusable themed string-prompt exists.
  Options: a generic `dialog.openTextPrompt` event + dialog component vs
  inline-rename surfaces (MacrosPanel pattern); fold trimmed/non-empty
  validation into whichever is chosen. Blocks code: yes, for rename UX work.
  Source: `src/modules/Command/useCases/commands/TrackCommands.ts`,
  `useCases/commands/ClipCommands.ts` (paths post-ADR-0007),
  `src/modules/Workspace/presentations/views/Sidebar/MacrosPanel.tsx`.

## BrowserAi

- **renderQueueStore lifecycle.** `markRenderComplete` keeps entries forever
  and `cachedPhraseIds` (cacheKey-keyed) cannot answer "is this phrase's cached
  audio still on disk?" (phraseId-keyed status map). Options: eviction +
  unified keying vs accept unbounded session growth. Blocks code: no. Source:
  `src/modules/BrowserAi/stores/renderQueueStore.ts:62-82`.
- **Kokoro "time-stretch" is rate+pitch coupled** while docstring/UI promise
  pitch-preserving stretch. Options: real time-stretch (phase vocoder) vs
  relabel the control as rate. Blocks code: no. Source:
  `src/modules/BrowserAi/useCases/renderKokoroTts.ts:174-184`.

## MIDI

- **chordTrackStore persistence scope**: localStorage at module-evaluate,
  synchronous persist per mutation, not in Automerge, no cross-tab sync — and
  the product call: is chord-track state project-scoped or session-scoped?
  Blocks code: yes, for chord-track persistence. Source:
  `src/modules/MIDI/stores/chordTrackStore.ts`.
- **setMidiLearnDependencies is module-mutable global state** (test/HMR
  isolation hazard). Options: DI seam vs accept the singleton. Blocks code:
  no. Source: `src/modules/MIDI/useCases/midiLearn/midiLearnDependencies.ts`.
- **Should midiStore carry a schemaVersion/migration_version in the Automerge
  document?** Blocks code: yes, for the next MIDI schema migration. Source:
  `src/modules/MIDI/stores/midiStore.ts`,
  `useCases/midiNoteCrud/migrateAbsoluteMidiNotes.ts`.
- **Authoritative coordinate system for MidiCC.beat / pitch-bend beat**
  (clip-relative vs timeline-absolute); `shiftMidiNotesAfterBeat` docstring
  asserts absolute while notes are treated clip-relative post-migration.
  Blocks code: yes, for CC/pitch-bend editing. Source:
  `src/modules/MIDI/useCases/midiNoteCrud/shiftMidiNotesAfterBeat.ts`,
  `models/MidiNote.ts`.
- **Is MIDI export → re-import a supported round-trip** or one-shot ingestion?
  Blocks code: no. Source: `src/modules/MIDI/useCases/exportMidiFile.ts`,
  `useCases/importMidiFile.ts`.
- **Trust model for controller scripting.** `new Function()` runs
  user-supplied JS in a Worker with no rate-limit or schema validation on
  posted setParam/sendMidi; intended scope (personal scripts vs shared
  marketplace) is undecided. Blocks code: yes, for shipping the scripting
  surface. Source: `src/modules/MIDI/workers/controllerScriptingWorker.ts:14-29`.
- **Ratchets / step-conditions**: undocumented pattern-logic gap (MidiNote has
  probability only). Options: add fields vs declare out of scope. Blocks code:
  no. Source: `src/modules/MIDI/models/MidiNote.ts`.
- **MIDI correctness spec home.** The prior audit's goal (note
  pairing/ordering, edit invariants, behaviour-asserting tests) has no spec on
  disk. Options: write `SPEC-MIDI` vs fold into module docs. Blocks code: no.
  Source: provenance `INV-MIDI` (no code locus).

## Grinder

- **Contract for `engineMode:'capture'` with `neuralEnabled:false`.**
  `migrateGrinderPatch` preserves explicit `neuralEnabled:false` in capture
  mode while the bridge forces `neuralEnabled = mode!=='circuit'`; the two
  paths can disagree. Options: mode derives the flag vs flag is independent.
  Blocks code: yes, for Grinder mode work. Source:
  `src/modules/Grinder/models/GrinderPatch.ts:435`,
  `useCases/grinderParamBridge/setGrinderParamWithAudio.ts:84`.

## Synth

- **Are the two parallel drum-kit schedulers both intentional?**
  `scheduleKitNote` (pitchRange + subtractive SynthParams) and
  `scheduleDrumKitNote` (midiNote + 808 DrumVoiceType) are both exported and
  both dispatched from Transport/live-MIDI/audition/offline. Options: converge
  vs document dual engines. Blocks code: yes, for drum-kit changes. Source:
  `src/modules/Synth/useCases/drumKitSynth.ts`,
  `useCases/drumSynthEngine/kitDefinitions/scheduleDrumKitNote.ts`,
  `useCases/index.ts`.
- **Offline render fidelity asymmetry — intentional draft mode?** The builtin
  synth's offline path drops osc2/sub/noise/vibrato/spread while drum kits
  render full-fat in the same offline pass. Options: full-fidelity offline
  synth vs documented draft mode. Blocks code: no. Source:
  `src/modules/Synth/engine/scheduleBuiltinSynthNote.ts` vs
  `engine/scheduleBuiltinSynthNoteOffline.ts` (split from the former
  `builtinSynth.ts`), consumers in
  `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts`.
- **CV unit model (gated on whether CV ships).** `setCvValue` clamps values to
  [0,1] while channels carry real voltage ranges, and `midiNoteToCv`'s Hz/V
  branch returns a raw frequency (e.g. 440) into a voltage-typed field.
  Options: adopt a real voltage model (volts, per-standard ranges) vs declare
  normalized [0,1] the contract and convert at the edge. Blocks code: yes, for
  any CV feature work. Source:
  `src/modules/Synth/useCases/cvGate/cvOutputOperations/setCvValue.ts:11`,
  `useCases/cvGate/cvConversion/midiNoteToCv.ts:16`.
- **cvGate `triggerPulseMs`/`gateThreshold` are persisted but dead** — defined,
  validated, and stored with zero production consumers. Options: wire them
  into the gate path or delete the fields. Blocks code: no. Source:
  `src/modules/Synth/stores/cvGate.ts:29-30,37-38,45`.

## CrdtDocument

- **actionHistoryStore is CRDT-backed under root**: each action mutates root
  twice (state + history) and history syncs to all peers, contradicting the
  per-user assumption in revertAction UX / AiActionHistoryPanel. Options:
  per-user local history vs shared synced history by design. Blocks code:
  yes, for collaboration + undo-history work. Source:
  `src/modules/CrdtDocument/stores/actionHistoryStore.ts:31`,
  `src/modules/Collaboration/useCases/automergeSync.ts`.

## Workspace

- **Bottom-dock default arm silently routes unknown tabs to
  `<RoutingMatrix/>`** — an 11th union value would route there unflagged.
  Options: exhaustive switch with `never` check vs keep the fallback. Blocks
  code: no. Source:
  `src/modules/Workspace/presentations/views/AppShell.tsx:380-381`.
- **Should bottomTab persist?** It is local `useState`, lost on reload.
  Options: move into workspaceStore vs session-only by design. Blocks code:
  no. Source: `src/modules/Workspace/presentations/views/AppShell.tsx:139`.
- **SessionView slot launch plays nothing** — writes only sessionLaunchStore;
  no Transport/engine call (store documents engine wiring as deferred).
  Options: wire clip launch to the engine vs hide the surface until then.
  Blocks code: yes, for session-view work. Source:
  `src/modules/Workspace/presentations/views/SessionView.tsx:33-41`,
  `stores/sessionLaunchStore.ts`.

## Collaboration

- **Host auto-grants editor to every connecting peer**, so a wired permission
  filter would still say yes to everyone. Options: role-selection UX on join
  vs deliberate open-by-default. Blocks code: yes, for permissions work.
  Source:
  `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:685`.
- **Role-revocation semantics undefined**: PermissionManager epoch increments
  on grant, last-writer-by-epoch wins, no revoke/reorder defined. Blocks code:
  yes, for permissions work. Source:
  `src/modules/Collaboration/useCases/permissions.ts:41-63,126-129`.
- **Is manual SDP copy-paste signaling permanent or a placeholder** for a
  signaling server (SignalingMessage types exist)? Blocks code: no. Source:
  `src/modules/Collaboration/models/CollaborationTypes.ts:43-49`.

## Levain

- **MIDI-routing isolation across Levain instances is unproven**: bridge state
  is module-level Maps plus a singleton store. Options: per-instance state vs
  prove output isolation of the singleton. Blocks code: yes, for
  multi-instance Levain. Source:
  `src/modules/Levain/useCases/levainParamBridge/helpers.ts:26-27`,
  `stores/levainStore.ts:47-49`.
- **Save/load contract for multiple Levain instances**: persistence is
  per-rust-key flush only; levainStore is in-memory with no
  hydration-before-register path. Blocks code: yes, for Levain persistence.
  Source: `src/modules/Levain/stores/levainStore.ts:47-49`,
  `useCases/levainParamBridge/helpers.ts:77-83`.

## Arrangement

- **ArrangementBar min-duration invariant is undocumented**: resize clamps to
  a 4-beat floor while addSection creates 16-beat sections. Options: one named
  constant + documented invariant vs intentional asymmetry. Blocks code: no.
  Source:
  `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:140-141,216-217`.
- **Timeline zoom bounds**: pixelsPerBeat hardcoded to [2,80]; cannot zoom in
  for dense MIDI nor out for long arrangements. Options: widen/adaptive bounds
  vs keep. Blocks code: no. Source:
  `src/modules/Arrangement/stores/timelineViewStore.ts:26`.

## AudioEngine

- **Eager audio-engine singleton**: `createWebAudioEngine` boots a live
  AudioContext + SAB at module import (tests/HMR/SSR all trigger it). Options:
  lazy init behind a getter vs accept eager boot. Blocks code: yes, for
  engine-lifecycle work. Source:
  `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:143-161`
  (constructor: SAB + AudioContext setup) and `:983`
  (`export const audioEngine = createAudioEngine()`).
- **AdjustmentBus reverb param mapping**: Size→'rev-mix', Damping→'rev-lowcut'
  are misaligned, and the recommended remap is infeasible — the reverb device
  exposes only rev-mix/rev-predelay/rev-lowcut. Options: extend the device
  param surface vs relabel the AdjustmentBus controls. Blocks code: yes, for
  the remap. Source: `src/modules/AudioEngine/engine/AdjustmentBusNode.ts:42,45`,
  `repositories/devices/reverbDelay/applyReverbParams.ts`.
- **No live-playback PDC delay path**: `TrackNode.routeOutput` connects
  straight to destination with no compensation DelayNode (offline render does
  compensate). Options: build live PDC vs document the limitation. Blocks
  code: yes, for latency-compensation work. Source:
  `src/modules/AudioEngine/engine/TrackNode.ts:195-208`.
- **NativePluginBridgeNode per-block IPC ceiling (architecture).** An async
  `tauriInvoke('process_plugin_audio')` per audio block means per-block IPC
  dominates the budget with many native plugins. Options: accept + cap
  concurrent native plugins vs change the boundary (batching, shared-memory
  transport, processing across the bridge). Blocks code: yes — no code change
  is correct until the boundary is chosen. Source:
  `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts`,
  `src/modules/Plugin/repositories/pluginBridge/processAudioIPC.ts:36`.
- **Faust real-time scheduling (product).** `faustDeviceFactory` schedules
  keyOn/keyOff via `setTimeout`-based `scheduleCall`, not sample-accurate.
  Options: accept timer scheduling for the target use cases vs build a
  look-ahead scheduler. Blocks code: no. Source:
  `src/modules/AudioEngine/repositories/faustDeviceFactory.ts:55-61,89`.

## GrandBoule

- **MidiPedalCcPayload is a non-discriminated `number|boolean` union**;
  consumers paper over with casts. Options: discriminated union vs split
  events. Blocks code: no. Source:
  `src/modules/Workspace/events/WorkspaceEvents.ts:51`.
- **SpectralWaterfall mutates the shared AnalyserNode** (`fftSize=512` on an
  AudioEngine-owned node). Options: per-view analyser vs documented shared
  config. Blocks code: no. Source:
  `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx:125`.
- **MIDI calibration never reaches the WASM engine** — calibration setters
  persist to store only, no `engine.setParam`. Options: wire the bridge vs
  declare calibration UI-only. Blocks code: yes, for calibration work.
  Source:
  `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setVelocityCurveExponent.ts`.
- **Pedal handler drops CC1/CC11/CC74** on a handler subscribed to all
  `midi.pedalCc` (only CC64/66/67 handled). Options: handle or filter the
  subscription. Blocks code: no. Source:
  `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:165-180`.

## Gluten

- **Per-module preset list by design?** GLUTEN_PRESETS + module-load-time
  CATEGORIES derivation vs deferring to an Arrangement preset library. Blocks
  code: no. Source: `src/modules/Gluten/useCases/glutenPresets.ts`,
  `presentations/views/GlutenPanel.tsx:147`.
- **Meter-path validation + error boundary**: raw worklet meter numbers are
  written to the store unvalidated and rendered directly; no panel error
  boundary. Options: validate at the registry sink vs trust the worklet.
  Blocks code: no. Source:
  `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:332-342`,
  `src/modules/Gluten/stores/glutenStore.ts:70-85`.
- **uiLevel (1..5) written but never read** — unfinished progressive
  disclosure? Options: build the disclosure UI vs delete the field. Blocks
  code: no. Source: `src/modules/Gluten/stores/glutenStore.ts:17,49-53`.

## Crust

- **No per-panel error boundary** — a Crust render fault tears down the whole
  app to the root fallback. Options: per-panel boundary policy (applies
  beyond Crust) vs root-only. Blocks code: no. Source:
  `src/modules/Workspace/presentations/views/AppShell.tsx` (CrustPanel mount),
  `src/modules/Workspace/presentations/components/ErrorBoundary.tsx`.
- **Dither offered at 32-bit float is a no-op** the UI does not signal.
  Options: hide dither at 32-bit vs annotate. Blocks code: no. Source:
  `src/modules/Crust/presentations/components/CrustControlZone.tsx:465`.

## Yeast

- **`MidiProcessor.latencySamples()` is a dead interface** — declared,
  defaulted to 0, overridden by nobody; MidiRack aggregates no latency for
  plugin-delay compensation. Options: implement PDC aggregation vs remove the
  method. Blocks code: no. Source:
  `src/modules/Yeast/workers/MidiProcessor.ts:43`,
  `workers/BaseMidiProcessor.ts:54`.
- **RT vs offline rack instances can share one singleton on worklet
  fallback**, clobbering activeNotes/scheduled between live input and
  playback. Options: per-context racks vs documented fallback limitation.
  Blocks code: yes, for Yeast scheduling work. Source:
  `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts`,
  `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts`.
- **`Harmonizer.timeOffsetSamples` is permanently 0** (used in arithmetic, no
  setParam case sets it); ship intent undecided. Options: expose the param vs
  delete the field. Blocks code: no. Source:
  `src/modules/Yeast/workers/processors/Harmonizer.ts:22`.
- **Is `loopStart === loopEnd` the intended loop-disabled convention?** Both
  bridge and offline paths infer loopEnabled as `loopStart < loopEnd`,
  unconfirmed against transportStore. Blocks code: no. Source:
  `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:33`.

## Toaster

- **applyEuclidean leaves stale step fields**: re-applying at a different hits
  count keeps velocity/probability/microTiming from the previous rhythm on
  newly-activated steps. Options: reset non-activation fields vs preserve by
  design. Blocks code: no. Source:
  `src/modules/Toaster/useCases/applyEuclidean.ts:32-35`.
- **Does the WASM worklet support a per-trigger engine override?** Needed to
  fix sound-lock cross-talk cleanly; Rust crate question. Blocks code: yes,
  for the sound-lock fix. Source:
  `src/modules/Toaster/useCases/sequencerPlayback.ts`,
  `useCases/loadToasterKit.ts` (TOASTER_ENGINE_MAP).
- **Planned cross-module API surface**: should Command/AI dispatch Toaster
  operations? `events/index.ts` is empty (no toaster.* events for
  CRDT/persistence/AI). Blocks code: no. Source:
  `src/modules/Toaster/events/index.ts:1`.
- **Are multiple Toaster instances per project supported?** The UI can create
  unbounded instances while note-repeat/16-levels/getFirstToasterDeviceId are
  global. Blocks code: yes, for multi-instance behavior. Source:
  `src/modules/Workspace/presentations/views/Sidebar/InstrumentsTab.tsx:197-202`,
  `src/modules/Toaster/useCases/loadToasterKit.ts:51`.
- **Is exportPatternToTimeline meant to be lossy or full-fidelity?** Blocks
  code: no. Source: `src/modules/Toaster/useCases/exportPatternToTimeline.ts:30-69`.
- **Is sequencer pause-and-resume a desired feature?** `stopSequencer` zeros
  playCount/currentStep so no playhead state survives a stop. Blocks code:
  no. Source: `src/modules/Toaster/useCases/sequencerPlayback.ts:219,221`.
- **ADR 0009 owner sign-off (pending)**: confirm the deterministic
  0.5-threshold pattern-morph contract with the product owner (vs a
  probabilistic morph relied on for generative variation). Blocks code: no.
  Source: `.agents/decisions/0009-toaster-pattern-morph-determinism.md`,
  `src/modules/Toaster/useCases/patternMorph.ts` (lerpStep).

## Bacteria

- **Are multiple simultaneous Bacteria instances an expected use case?** Gates
  whether the N×60Hz full-map-clone re-render cost (every open panel
  re-renders on any device's meter tick; `useStore` has no selector) is worth
  fixing. Options: selector support + per-instance slices vs accept for a
  single-instance product. Blocks code: yes, for the fan-out fix. Source:
  `src/modules/Bacteria/stores/bacteriaStore.ts`,
  `presentations/views/BacteriaPanel.tsx`, `src/infra/store/useStore.ts:5-7`.
- **SpectrumAnalyzer.fftData transport: SAB-fed or post-message?** No FFT
  slice is exposed by BacteriaNode today. Blocks code: yes, for the analyzer.
  Source: `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx`.
- **Are morphX/morphY and snapshots[] meant to drive other parameters?** No
  use case reads them for morphing. Blocks code: no. Source:
  `src/modules/Bacteria/models/BacteriaPatch.ts:168-176`,
  `presentations/views/BacteriaPanel.tsx:403-404`.
  (Lab editors / ModulationDock drag-to-assign: see the cross-cutting
  audit-deferrals pointer above — the add path is gated on that same call.)

## VirtualKeyboard

- **Focus contract is undiscoverable**: notes fire only when the tabIndex=0
  panel is focused; no ready/focused indicator. Blocks code: no. Source:
  `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:354,386`.
- **Screen-reader accessibility**: `role="application"` panel with
  `role="button"` keys lacking tabIndex/keyboard activation. Options: proper
  ARIA/keyboard model vs declare pointer-only. Blocks code: no. Source:
  `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:359,500,540`.
- **No VirtualKeyboard spec** — the prior audit's prescriptive layer
  (release-all-on-unmount/visibility, event.code mapping, velocity-from-y,
  octave range) was never lifted into a spec. Blocks code: no. Source:
  module at `src/modules/VirtualKeyboard/` (no spec on disk).
- **triggerLiveNoteOff idempotency unverified**; no all-notes-off/panic use
  case exists for cleanup paths (StrictMode double-mount, onBlur+pointerup
  overlap). Blocks code: yes, for keyboard cleanup hardening. Source:
  `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:204,339`;
  no panic use case under `src/modules/AudioEngine/useCases/`.

## Scoring

- **Non-atomic read-merge-write races** between updateTunerTelemetry and
  setA4Reference/setDisplayMode can lose a preference write. Options: keyed
  updates in the store vs accept the race. Blocks code: no. Source:
  `src/modules/Scoring/stores/scoringStore.ts:55-59`,
  `useCases/setA4Reference.ts`, `useCases/setDisplayMode.ts`.
- **a4Reference bounds 400–490 exclude historical tunings** (392/415/466/500
  Hz). Options: widen bounds vs document the range. Blocks code: no. Source:
  `src/modules/Scoring/presentations/views/ScoringPanel.tsx:121-123`.
- **Raw DisplayMode literal rendered to users** (lowercase `detail={mode}`),
  inconsistent with human labels elsewhere. Blocks code: no. Source:
  `src/modules/Scoring/presentations/views/ScoringPanel.tsx:84,224`.

## AiRuntime

- **PayloadValidator predicate bodies are unverifiable by TS** — the
  `satisfies Record` guards only the map shape; multiple validators silently
  drift from payload types (systemic). Options: schema-derived validation
  (Zod per action) vs hand predicates + tests. Blocks code: yes, for action
  contract growth. Source:
  `src/modules/AiRuntime/useCases/validateActionPayload.ts:402`.
- **"Handler already validates trackId" is an unverified justification** for
  ~70% "unchecked" actions (removeAllTracks, exportDawProject, loadPreset,
  generate*, stemSeparate) — no test or compile-time linkage. Needs an
  investigation pass. Blocks code: no. Source:
  `src/modules/AiRuntime/useCases/validateActionPayload.ts:196-401`.

## Project

- **Two divergent Tauri-detection paths in one module**:
  `nativeProjectFiles/helpers.ts` uses legacy `window.__TAURI__` while the
  canonical bridge uses `__TAURI_INTERNALS__`. Options: converge on
  `#/utils/tauriBridge` vs justify the fork. Blocks code: no. Source:
  `src/modules/Project/repositories/nativeProjectFiles/helpers.ts:4,13,20`.
- **Are demo projects meant to be deterministic/regenerable from a seed?**
  They mutate global stores with interleaved async setup; rapid double-launch
  can race. Blocks code: no. Source:
  `src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts`.
- **localStorage quota policy + recent-list lifecycle**: policy for
  legacy/oversized projects exceeding quota, and whether recentProjects should
  survive project deletion (newProject does not clear the list). Blocks code:
  no. Source:
  `src/modules/Project/useCases/projectPersistence/newProject.ts:65`.
- **autoSaveVersion has no production caller** (only CRDT autosave is wired).
  Options: wire version-control autosave vs remove. Blocks code: no. Source:
  `src/modules/Project/useCases/versionControl/autoSaveVersion.ts:5`.
- **`.sourdaw` round-trip: serialized-vs-runtime schema reconciliation.**
  tempoMap/timeSignatureMap (serialized shape drops runtime `id`/`curve`) and
  takeLanes need a schema decision — widen the serialized schema to carry
  id/curve vs mint deterministic ids + default curve on import — before their
  exported fields can be hydrated. Blocks code: yes, for round-trip fidelity.
  Source:
  `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts`,
  `models/ProjectData.ts:350-363,396-406`,
  `src/modules/Transport/stores/tempoMapStore.ts`.
- **`.sourdaw` round-trip: engine-coupled + structural hydrations.**
  sidechainRoutes hydration requires live engine wiring
  (`setSidechainRoutes` → `wireSidechainRoute`), and multi-arrangement import
  collapses to a single snapshot (`ProjectArrangementSnapshot` members typed
  `unknown`, need per-field validation). Options: build validated hydration
  paths vs document export-only fields. Blocks code: yes, for import
  fidelity. Source:
  `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts`,
  `src/modules/Routing/useCases/sidechain/setSidechainRoutes.ts`.
- **Recent-projects Option B migration** (per-project CRDT docs +
  `loadProject(id)`, retiring the flat-JSON snapshot surface) — the long-term
  direction left open by ADR 0008. Blocks code: no (Option A shipped). Source:
  `.agents/decisions/0008-recent-projects-load-backend.md`.
- **Legacy-MIDI migration coverage (product).** `migrateAbsoluteMidiNotes`
  gates on `/melody|chords|drums|copy/i` name match + `minStart >=
  clip.startBeat`, by design missing renamed or hand-edited AI clips. Options:
  accept the residual vs audit real stored projects to size the gap before
  widening. Blocks code: no. Source:
  `src/modules/MIDI/useCases/midiNoteCrud/migrateAbsoluteMidiNotes.ts`.

## Crumbs

- **Web/non-Tauri build: bridge calls silently void with no real audio** — E2E
  against the browser build exercises a working-looking UI over a no-op
  bridge. (The hardcoded "Ready" LED was since fixed: CrumbsPanel now gates
  the LED on an engineReady init check.) Options: explicit unavailable state
  for the whole panel vs accept browser-build UI-only. Blocks code: yes, for
  honest E2E coverage. Source:
  `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:82-105` (LED gate),
  `repositories/crumbsBridge/` (void-returning web fallbacks).
- **rootNote snaps to C4 on missing detection with no override UI** —
  chromatic pad play transposes relative to a root the sample isn't tuned to.
  Blocks code: no. Source: `src/modules/Crumbs/stores/crumbsStore.ts:109`.
- **`setCrumbsParamImmediate` is reserved-or-dead**: zero production callers
  (production uses the throttled variant exclusively; the once-dead
  `triggerPadOff` has since been wired to PadGrid release, and the old
  `allSoundOff` use case was removed). Options: wire or delete. Blocks code:
  no. Source:
  `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts`.
- **Slice markers exist in UI state only** — drags write sliceStore, never the
  engine; no `set_slice_marker` IPC exists. Options: add the IPC + engine path
  vs UI-only markers by design. Blocks code: yes, for slice playback. Source:
  `src/modules/Crumbs/useCases/updateSliceMarker/debouncedUpdateMarkerPosition.ts:16`,
  `src-tauri/src/commands/crumbs.rs`.

## Knead

- **Canonical owner of the knead-clip schema and PitchContour.** Five forks
  disagree on fields (Knead wide store shape vs Arrangement/Project narrow
  persistence vs worklet blob; PitchContour `algorithm` optional in Knead,
  required in AudioEngine), with `as` casts fabricating undefined fields
  either way. Decide the owning module, whether the narrow persistence subset
  is intentional, and whether `originalPitchCenterCents` must be persisted.
  Blocks code: yes, for any Knead schema work. Source:
  `src/modules/Knead/stores/kneadStore.ts:6-44`,
  `src/modules/Arrangement/models/Track.ts:125-139`,
  `src/modules/Project/models/ProjectData.ts:333-347`,
  `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts`.

## SampleLibrary

- **Library-root identity across reconnects**: path vs content hash vs seeded
  UUID (today a random `lib-<uuid>` per connect duplicates roots). Blocks
  code: yes, for library persistence. Source:
  `src/modules/SampleLibrary/useCases/connectFolder/connectFolder.ts:17,51`.
- **Preview-stop ownership**: should stop-on-unmount/folder-change live in
  LibraryBrowser or Workspace.usePreviewAudio? Today audio keeps playing after
  the sample is no longer visible. Blocks code: no. Source:
  `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx`.
- **audioBufferCache owner + eviction policy**, and push-vs-pull for
  SampleLibrary buffers. Blocks code: no. Source:
  `src/modules/AudioEngine/stores/audioBufferCache.ts:37-53`,
  `src/modules/SampleLibrary/useCases/factoryContent/seedFactoryLibrary.ts:80`.
- **Where does the audio-decoding pipeline live** (browser OfflineAudioContext
  vs Tauri reads)? Currently split across drag-out and preview paths. Blocks
  code: yes, for decode consolidation. Source:
  `src/modules/Arrangement/presentations/hooks/useTimelineFileDrop.ts:114-157`,
  `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx:155`.
- **Is the factory library shipped or experimental?** Decides whether the
  first-launch synthesis stall (hundreds of awaited main-thread createBuffer
  calls in useAppInitialization) is a release blocker. Blocks code: no.
  Source:
  `src/modules/SampleLibrary/useCases/factoryContent/seedFactoryLibrary.ts:70-91`,
  `src/modules/Workspace/presentations/hooks/useAppInitialization.ts:88`.

## AiGeneration

- **Stem-separation dual path**: preview (action) vs command-bus diverge in
  cache keys and track creation; which is canonical? Blocks code: yes, for
  stem-separation changes. Source:
  `src/modules/AiGeneration/useCases/actions/handleStemSeparationPreview.ts:25-31`,
  `handlers/aiMidi/handleStemSeparate.ts:33-53`.
- **Does undo cover AI-created tracks?** `undoable:true` handlers register no
  explicit pushUndoEntry — rollback depends on whether Command's diff
  middleware diffs trackStore or only midiStore. Needs verification then a
  contract decision. Blocks code: no. Source:
  `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts:63` (and
  sibling handlers).

## Proof

- **Designated pattern for ~60Hz meter store updates under React Compiler** —
  the unified-map store spreads the whole instances map per tick. Options: a
  sanctioned high-rate-telemetry store pattern (selectors/refs/SAB-read) vs
  accept. Blocks code: yes, for meter-heavy modules (Proof, Bacteria share
  it). Source: `src/modules/Proof/stores/proofStore.ts:92-112`.
- **Should uiLevel/abBypass persist in the project patch?** Session-scoped
  today, absent from ProofPatch. Blocks code: no. Source:
  `src/modules/Proof/stores/proofStore.ts:32,46`.
- **Preset LUFS values need DSP review**: 'cd' targets −9 (CD practice is
  nearer −12), 'club' and 'loud' both land at loud targets (possible UI
  double-listing). Blocks code: no. Source:
  `src/modules/Proof/useCases/proofPresets.ts:37,43,87`.
- **Project-wide i18n**: no framework exists; externalizing hard-coded UI
  strings (e.g. Proof preset target labels) requires adopting one first.
  Options: adopt i18n vs English-only for now. Blocks code: no. Source:
  `src/modules/Proof/useCases/proofPresets.ts`; no i18n dependency in
  `package.json`.

## Automation

- **Automation lane addressing lacks a device id**: applyAutomation writes
  only the FIRST device on a track exposing the parameter; two devices with
  the same parameterId cannot both be automated. Options: add deviceId to the
  lane model vs first-match by design. Blocks code: yes, for multi-device
  automation. Source:
  `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts:81-104`.
- **Action-contract coverage**: 9 handlers vs ~22+ use cases —
  selection/zoom/draw/modulation and several lane ops bypass
  undo/history/macro recording. Options: promote them into the action contract
  vs declare them view-local. Blocks code: no. Source:
  `src/modules/Automation/useCases/getAutomationHandlers.ts:32-44`.
- **recordingSessionState DI-seam investment**: the singleton holder was
  consolidated (round 2) but a real DI seam means rerouting five consumers and
  six mocking specs. Options: full DI refactor (sibling
  `recordingDependencies.ts` pattern) vs accept the single holder. Blocks
  code: no. Source:
  `src/modules/Automation/useCases/automationRecording/recordingSessionState.ts:54-62`.
- **Linked-lane null contract (owner sign-off pending)**: `linkedLaneId` now
  makes the source authoritative — an empty source yields `null`, never the
  lane's local points (behavioral change vs the prior fallback). Confirm with
  the product owner; do not revert without an owner call. Blocks code: no.
  Source:
  `src/modules/Automation/useCases/automation/getAutomationValueAtBeat.ts:37-53`.

## AudioAnalysis

- **handleAudioToMidi contract**: drops `targetPitch`/`minInterval`, silently
  coerces `mode`; the AppAction advertises `mode?: string` instead of a
  discriminated union. Options: honest narrow contract vs full param support.
  Blocks code: no. Source:
  `src/modules/AudioAnalysis/handlers/analysis/handleAudioToMidi.ts:14-20`,
  `src/modules/Command/models/AppAction.ts`.
- **Mix analysis is synthetic, not measured** — is a real user reference-track
  buffer intended (no such API exists)? `analyzeMix` estimates a profile from
  track layout (kind/gain heuristics, default analysis values), yet two paths
  consume it as real signal: musicMentor's `generateLessons` (via the
  `analyzeMixFromTrackLayout` barrel alias) bases lessons on it, and
  `compareToReference` (dispatched via its own `compareToReference` AppAction)
  compares it against `createReferenceAnalysis`'s equally synthetic reference
  profile. Blocks code: yes, for mentor-lesson and mix-comparison credibility.
  Source:
  `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts`,
  `analyzeMix/createReferenceAnalysis.ts` (consumed only by
  `../compareToReference.ts:3-4`), lesson consumer
  `src/modules/AiRuntime/useCases/musicMentor/generateLessons.ts:9,15,25`.

## Fermenter

- **Scope and contract of spectral-domain morphing** relative to the existing
  time-domain warp. Blocks code: yes, for the spectral feature. Source:
  `crates/daw-dsp/src/fermenter/spectral.rs:1-2`.

## Routing

- **Where does cross-module cycle detection live** (output + sends +
  sidechain) given model-isolation constraints? Candidate shared walker exists
  in Arrangement. Blocks code: yes, for routing-graph safety. Source:
  `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:7-29`,
  `src/modules/Arrangement/services/getUpstreamSubgraph.ts`.
- **Sidechain re-wiring on project load**: hydrateSidechainRoutes vs
  ensureTrackStrips (engine-readiness timing). Blocks code: yes, for load
  ordering. Source: `src/modules/Routing/useCases/hydrateSidechainRoutes.ts:10-12`,
  `src/modules/Transport/useCases/ensureTrackStrips.ts`.
- **Should bus deletion cascade to remove targeting sends[]?** No removeBus
  AppAction exists today. Blocks code: no. Source:
  `src/modules/Arrangement/useCases/removeTrack.ts:28-70`.

## Investigation passes owed (from the overview triage)

Meta-items that need a pass before any decision; do not treat absence of a
finding as absence of a problem.

- **Runtime profiling pass**: chat re-render and fader write-volume behavior
  (structural reads only so far).
- **Dedicated Timeline (`T-*`) and browser (`B-*`) inventory pass** — flagged
  as owed by the combined review.
- **Backlog module reads**: Knead, Fermenter, LocalStorage, Scoring were not
  opened in the overview pass — unverified rather than confirmed.
