---
type: decision-docket
status: open
date: 2026-07-16
---

# Open-decision docket

Genuinely open product/architecture decisions that an agent cannot settle
unilaterally. Promoted from `.agents/findings/inventory-decisions-backlog.md`
(2026-06-19 inventory triage, since retired) and
`.agents/findings/overview-open-decisions.md` (also retired). Citations and
premises were fully re-audited against `main` on 2026-07-16 after three
review rounds — every item re-checked, drifted citations corrected, resolved
premises dropped (123 bullets: 120 decision items + 3 investigation
meta-items; the handler-contract item added by PR #351 was resolved
2026-07-17 — neutral utils home, #335). A 2026-07-18 ADR-0011 Wave 7 prep
pass added 8 more decision items — worklet-support seam, webMidiStore /
mixerSnapshotStore placement, AiGeneration scale-theory triplication,
ProofChamber dead preset repos, Setlist handler-map spec gap, Workspace
`scoring`→Tuner wire drift, ElasticAudio warp-algorithm surface — for a
current 131 bullets: 128 decision items + 3 investigation meta-items.
Decisions already
made are **not** here — they are ADRs (0006
contract-folder barrels, 0007 command relocation, 0008 recent-projects
Option A, 0009 pattern-morph determinism).

Item format: decision statement · options/tradeoff · blocks code work? ·
source citation.

## Decisions taken 2026-08-04/05 (ultracode campaign)

Recorded here so the docket stays the ledger of what was settled, not only of
what is open. Neither was engineering's to take unilaterally.

- **Rust gating shape — owner chose: extend `scripts/health-gates-server.sh`.**
  Options were a separate CI job, extending the existing gate script, or leaving
  the workspace ungated. The script keeps one definition of green for local and
  CI so the two cannot drift, which is how the web side already works. Landed
  #1097 (`cargo clippy --all-targets`, `cargo test`, both debug — the
  `assert_no_alloc` interceptor is compiled out in release) and #1136 (the
  `cargo fmt --check` leg, after #1098 reformatted 96 files so the leg could
  pass). `-D warnings` deliberately **not** set: 239 pre-existing warning sites,
  and `#[allow]` would be evasion. `src-tauri` excluded from the build legs — it
  cannot compile on `ubuntu-latest`. (Since the Electron cutover the excluded
  crate is `sourdaw-native`, for the same unconditional-`metal` reason.)
  Context the decision did not change: `health-gates.yml` is
  `on: workflow_dispatch` only because the account's Actions billing is
  suspended, so *nothing* runs automatically today. Restoring it is one `on:`
  block whenever billing is.

- **Parameter-automation coverage — owner chose: its own spec, not folded into
  Phase 2 and not built now.** Phase 2 measured that Fermenter reaches 15 of its
  105 parameters declared `automatable: true` (~106 parameter-level gaps
  overall). Written as `SPEC-parameter-automation-coverage`, `status: draft`,
  with the audit as its first acceptance criterion — because a param declared
  automatable may be *structurally* unschedulable, in which case the descriptor
  is the defect and the real number is far below 106.

### Programme blockers, recorded here as the formal record — 2026-08-07

The ultracode brief's `Done` requires each phase to be *landed or explicitly blocked
with the blocker named*. The per-phase ledger lives in `SURVEY-ultracode-scope.md`;
the one phase that is genuinely **blocked** — as opposed to merely unstarted — is
recorded here so the blocker sits in the decision record rather than only in a survey
note. It is not an owner decision; it is an engineering precondition.

- **Phase 5 (one implementation per transform) — blocked, two named blockers.**
  (i) It is sequenced *after* phases 2–4, and Phase 2 is partial: its AC-3 was not
  built by design and AC-4 sits behind AC-3, while AC-0's browser null harness needs
  cross-origin isolation, wasm fixtures for 13 devices, and `BaseAudioContext`
  widening — a phase of its own. (ii) Its FFT choice cannot be made until a
  **per-package `.wasm` size ceiling is stated**, because `proof-chamber` and
  `scoring` have no dependency edge to `daw-dsp`, so sharing one primitive grows two
  binaries rather than deduplicating one. Stating that ceiling is the unblocking act.

- **Phase 3 (one clock) — NOT blocked. Unstarted, with a measurement owed before
  design.** An earlier draft of this entry called it blocked; that was wrong, and the
  survey's own reconciliation says so plainly — *"no external blocker — capacity, not
  obstruction"*. Nothing external is withholding it. What it owes itself before
  choosing between "re-derive position every tick" and "keep an integrator and
  reconcile" is a measurement: worker-tick jitter under UI load, and `currentTime`
  granularity on the target. Owing yourself a measurement is not the same as being
  blocked, and recording it as blocked would launder an unstarted phase into an
  excused one.

- **Phases 7 and 8 are neither landed nor blocked.** Phase 7 is **partially landed**
  — #1252, #1253, #1261, #1262 — with nine named items remaining and no obstruction on
  any of them. Phase 8 is unstarted apart from #1075 closing the RAVE half of §3.8.
  Neither state is one the brief's `Done` admits as terminal, and saying so is more
  useful than inventing a blocker.

**Owner-decision surface. An earlier draft of this entry claimed the 2026-08-05→07
work "removed no capability and changed no existing project's sound". That was false,
and the correction matters more than the original claim.**

The two decisions the brief names as *currently open and known* — the shape of a
project file, and whether it embeds audio or references it — were both **ratified** in
ADR 0014 on 2026-08-03 and 2026-08-04 respectively; that ADR's own Status line records
gates **M1–M10** as reported or formally deferred.

But two changes inside the window did meet the brief's definition of an owner decision:

- **#1236 removed GrandBoule's `afterTouchSensitivity` control** — *"what capability is
  removed"*. Its commit message records it as taken **per the owner**, so it was put in
  front of them; it is logged here so the record shows it, not to re-open it. The
  research behind it has since been partly corrected — see the Keyscape refutation in
  `SURVEY-ultracode-scope.md` — and the removal survives that correction on its
  remaining sources.
- **#1236 also wired `sustain_threshold` and `cc_smoothing_ms`, and #1249 wired Crumbs'
  master tune** — *"changes how existing projects sound"*. `sustain_threshold` had been
  inert behind a hardcoded `HALF_PEDAL_LOW` of 0.15, so any project storing a
  non-default value renders differently now. These needed no separate confirmation:
  ADR 0016 rules that with no users, correctness wins outright and no compatibility
  path is carried, and the brief states that anything inside an accepted ADR is merged
  without asking. Recorded because *"it was covered by an ADR"* and *"nothing changed"*
  are different statements, and only the first is true.

The remaining owner-decision surface is the finish-or-remove ledger below: each row is
an owner decision by the brief's own definition, and the brief is explicit that filing
to this docket is **not** the same as putting one in front of the owner.

### Corrections to rows above, from campaign work

- **RAVE timbre-transfer** (row in "Unbuilt feature subsystems"): the stated
  options were "wire the RAVE UI/flow, or remove the 9 use cases". #1075 took
  neither — it **gated the surface on real model presence**. The palette
  entries and `loadModel` now require weights actually registered from OPFS, so
  nothing is advertised that cannot run, and the entries return by themselves if
  weights ever land. The use cases survive unwired. The row stays open as a
  finish-or-remove question; what changed is that the *dishonesty* is closed —
  `encodeAudio`/`decodeLatent` were a `Math.sin`/`Math.tanh` transform returning
  0.718-peak audio while logging "RAVE model loaded".
  Note for whoever finishes it: the probe asks OPFS for `rave/<model.id>` while
  the catalog declares `models/rave/strings.onnx`, and `downloadModel` is never
  called with `family: 'rave'` — so shipping RAVE needs a download entry keyed to
  that family, not merely weights appearing.

- **Smaller dormant features → Bacteria**: two more inert controls found and not
  previously listed — `crossoverSlope` and `crossoverMode` reach an explicit
  `=> {}` no-op arm in `bacteria/engine.rs:795`, so every value behaves
  identically.

## Unbuilt feature subsystems (finish-or-remove)

Whole subsystems that are **dead or dormant in production today** — each an
honest *finish it* or *delete it* call (multi-file either way), not a cleanup
fix. Left intact by the 2026-06-26 module-audit remediation under its explicit
rule (*do not half-build a feature, do not unilaterally delete a parked
subsystem*). The code is the live source of truth for each row's present state;
citations were re-verified against `main` on 2026-07-16. Make each
ship-or-retire call against this table; do not delete rows piecemeal. Blocks
code: no (all dormant).

| Subsystem | Module(s) | State today | Decision |
|---|---|---|---|
| **Extension module** (whole) | Extension | Architecturally complete but **FROZEN** by its own store header (`stores/extension.ts:5-7`) until a Worker sandbox replaces the unsandboxed `new Function` eval; zero non-spec importers | Build the Worker/CSP sandbox + permission enforcement + barrels, or remove the module. **RESOLVED 2026-07-18 (#427): module deleted — user decision (unfreeze + delete), ADR-0011 W7.** |
| **DDSP synthesis pipeline** | BrowserAi | Exact Magenta runtime artifacts are pinned by URL, size, and SHA-256; direct-only downloads publish versioned OPFS generation truth; a TF.js worker confirms WebGPU before rendering. Checkpoint permission is recorded separately and no Apache license is claimed for the weights. | **RESOLVED 2026-08-21 (#2261): admitted browser and desktop pipeline is implemented and test-guarded.** |
| **RAVE timbre-transfer** | BrowserAi | Model discovery is OPFS-gated and no factory weights are available; placeholder encode/decode/transfer operations remain unshipped | Build model provisioning and real inference, or remove the placeholder pipeline |
| **WAM plugin host** | Plugin | `loadWAMPlugin` never called by any production JS (`useCases/wamPluginHost/hostOperations/loadWAMPlugin.ts`) | Build host load/query + UI, or remove the host surface |
| **Push 2 hardware controller** | ControlSurface | Protocol/codec primitives exist, but no production hardware transport owns them; the two files remain visible `no-orphans` warnings. `handlePadPress` now does an indexed write with a clamped velocity instead of a full `.map()` scan (issue #1828 F-6/F-7); `updateDisplay`/`setPadColor`/`setPadMode`/`setScale`/`mapEncoder` and `pushStore`'s UI reader are still unreached outside specs | Build the connection lifecycle tracked by #1745; do not delete or exempt the primitives |
| **MIDI hardware controller** | ControlSurface | `export/importHardwareMappings` dead; profiles never populated; the unshipped controller-scripting Worker was retired in #1746. `hardwareControllerStore` is now seeded with `PUSH_2_PROFILE` and `importHardwareMappings` notifies on an unknown `profileId` instead of silently no-opping (issue #1828 F-8), but `matchControllerProfile` still has no production caller and no device-identity data to match against | Build device wiring, or remove the remaining subsystem. Any future scripting surface requires a new trust-model decision |
| **MCU/OSC control-surface protocol layer** | ControlSurface | `stores/controlSurface.ts` (`McuState` banking/vpots, OSC endpoints/mappings) is reachable only through `setProtocol`; `mcuBankLeft`/`mcuBankRight`/vpot/OSC dispatch have no production caller. `connected` is now kept in sync with `protocol` inside `handleSetControlSurface` and the banking use cases no longer reassign the master fader or leave channel faders unclamped (issue #1828 F-4/F-5) | Build the MCU/OSC hardware transport wiring, or remove the protocol-state model. Same desktop-deferral class as the Push/MIDI hardware controller rows above (ADR 0016) |
| **Native CRDT backend + `.sdaw` import/merge** | CrdtDocument | `nativeCrdtPersistence/` parked; PR #110 fixed the misleading `getPersistenceBackend()` report so the active lifecycle reports browser/IndexedDB; `.sdaw` merge wired but no trigger | Build the native backend / `.sdaw` import UI, or remove |
| **Toaster performance features** | Toaster | Note-Repeat / 16-Levels / Sound-Locks / Pattern-Morph / multi-pattern / polymetric — full impls, no UI/command entry; their sequencer reader branches are dead | Ship each (UI + command + e2e) or retire it with its branches |
| **Yeast param-readback / introspection UI** | Yeast | StepPatternEditor edits never reach the Arpeggiator; all panel knobs uncontrolled; 12 introspection methods + reorder are unbuilt-feature groundwork. (`yeastPanic` is now wired via Transport `panicYeastRuntime` → Yeast `yeastPanic` — no longer part of this row) | Build the param-projection store + pattern/reorder wiring, or retire |
| **SoundLibrary vs SampleLibrary** | SoundLibrary | Two modules own "the sample library"; only SampleLibrary has a UI; their `findSimilarSamples` return types are incompatible (`SampleEntry[]` vs `string[]`) | Decide the owner; retire or merge the other (cross-module model-merge is forbidden — an ownership/migration decision) |
| ~~**Collaboration transport-permission**~~ *(closed — ADR 0016 ruling 4)* | Collaboration | The role scaffold (`PermissionManager`, `canControlTransport`, `getRole`, `transport-controller`/`viewer`) was deleted; an invite is documented as unconditional write access in `useCases/collaboration/generateInvite.ts` and `Collaboration/AGENTS.md` | Resolved: scaffold removed |
| **GrandBoule sampled-attack** | GrandBoule | Hybrid attack-clip pathway wired through types, no production caller | Wire the attack-clip load flow, or remove |
| **Synth CV/Gate** | Synth | Convert+write path inert; only `addCvOutput` wired | Build the modular CV/Gate UI, or remove the convert/write ops |
| **SampleLibrary embedding (Find-Similar / UMAP)** | SampleLibrary | `setEmbedding` never called (`stores/embeddingStore.ts:22`, zero callers) → embeddings map always empty → Find-Similar returns `[]`. The `presentations/views/LibraryBrowser.tsx:449` "Re-project UMAP" button is live but silently no-ops for the same reason — hide or wire it regardless of the finish-or-remove call | Build embedding population, or remove the G2/G3 controls |
| **Smaller dormant features** | Crumbs (metering read-back, Warp/Mod-XY, automation→engine routing), Scoring (PolyDisplay), Automation (linked-lanes, envelope modulator), Bacteria (Lab-bench wiring) | each wired-but-dead | finish or remove per the per-module audit |

- **DJ mode / VCV Rack integration — keep or drop (product line).** Niche
  ideas surfaced during intake decomposition with no owning spec: DJ mode is
  missing entirely; VCV Rack integration and AI-generated modulation patches are
  missing while Synth CV/Gate exists. One line: keep or drop. Blocks code: no.
  Migrated from ADR-0010 Open questions. Source:
  `.agents/decisions/0010-product-restraint-principles.md` ("Open questions").

## Infra / store

- **Cross-store durability limit: are multi-store Automerge writes allowed to
  be non-atomic?** `batchStoreUpdates()` defers notifications only; a
  multi-store write that fails midway persists a partial cross-store state.
  Options: build a multi-key CRDT transaction vs document and accept the risk.
  Blocks code: no, but gates any feature relying on cross-store invariants.
  Source: `src/infra/store/createStore.ts:35-45`.
- **`LocalStorageKeys` legacy-key legal review (I-28).** The file header
  requires every key addition/deletion/change be reported to the legal
  department for Cookie-Policy transparency — out of scope for an agent to alter
  unilaterally. Decide the review/cleanup owner for the legacy keys. Blocks
  code: no. Migrated from ADR-0010 Open questions. Source:
  `src/infra/store/storage/LocalStorageKeys.ts:1-13`.

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
- **No rule catches a `stores/` file that is really a use case.** The known
  live instance — `duplicateClipNotes` reading/transforming/writing midiStore
  from `stores/` — was since relocated to `useCases/midiNoteCrud/` and dropped
  from the `stores/` barrel, resolving that concrete example; the general
  question stands with no current instance. Options: design a structural rule
  (store files export only store + selectors) vs case-by-case relocation.
  Blocks code: no. Source:
  `src/modules/MIDI/useCases/midiNoteCrud/duplicateClipNotes.ts` (relocated from
  `stores/`).
- **Close the main-cruise validator config gaps.** The main cruise
  (`.dependency-cruiser.cjs`) does not set `tsPreCompilationDeps`, so type-only
  imports are invisible to its rules — only the types
  (`.dependency-cruiser.types.cjs:79`) and tests
  (`.dependency-cruiser.tests.cjs:177`) cruises enable it; and the
  `src/helpers/` shadow-layer exclusion anchor at `.dependency-cruiser.cjs:752`
  (`^src/helpers/Store/Storage/AutomergeStorage\.ts$`) points at a retired file
  location — the live file is `src/infra/store/storage/createAutomergeStorage.ts`.
  Options: enable `tsPreCompilationDeps` on main + repoint/remove the stale
  anchor vs accept the blind spots. Blocks code: no. Source:
  `.dependency-cruiser.cjs:269,752,918`.
- **Retire the live `no-orphans` warn backlog: 2 orphans remain.** The main
  cruise reports `src/modules/ControlSurface/repositories/pushDisplayProtocol.ts`
  and `pushMidiCodec.ts`: both implement Push 2 protocol primitives, but no
  production hardware transport owns them. Wire them through the real connection
  lifecycle tracked by #1745; do not delete or exempt them. Blocks code: no.
  Source: `node scripts/check-dependency-boundaries.mjs` (main: 2 warnings).
- **Tests cruise exempts same-module barrel imports, contradicting the written
  same-module rule.** `.dependency-cruiser.tests.cjs` exempts same-module
  targets via `pathNot: '^$1$2'` in both the `cross-module-index-only` and
  `no-relative-cross-module-imports` rules, so a spec importing its own module's
  contract barrel (`../index` from `__tests__/`) passes the gate while
  contradicting CLAUDE.md's same-module rule (relative-to-file only, never the
  module's own barrel). Options: extend the tests cruise to ban own-barrel
  imports from specs vs amend the doc to permit it. Blocks code: no. Source:
  `.dependency-cruiser.tests.cjs:63-75,83-93`; PR #330 review 4717538952 (two
  merged specs used the pattern, gate stayed green).

## Transport

- **Store persistence contract: which Transport sub-stores are project truth?**
  `transportStore.toCrdt` is a hand-maintained projection with no compile-time
  guard; setlist/loopStation/punchRecording stores use bare `createStore`, so
  their state is lost on save/load. Options: wire them into Automerge vs
  declare them session-scoped. Blocks code: yes, for any setlist/loop/punch
  persistence work. Source: `src/modules/Transport/stores/transportStore.ts`,
  `src/modules/Setlist/stores/setlistStore.ts`, `src/modules/SessionLauncher/stores/loopStationStore.ts`, `src/modules/PunchRecording/stores/punchRecordingStore.ts` (now separate modules).
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
  `src/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler.ts` (transportStore
  punch), `src/modules/PunchRecording/useCases/punchRecording/startBackgroundCapture.ts` (state-only),
  `src/modules/PunchRecording/presentations/views/PunchRecordingControls.tsx` (mounted at
  `src/modules/Workspace/presentations/views/TransportBar.tsx:133`).
- **Setlist–transport coordination contract.** `goToItem` only sets
  currentIndex and emits a programChange; no seek/tempo/timesig/project load;
  autoAdvance/countInBars/gapSeconds are read by nothing. Options: specify the
  live-set behavior vs park the feature. Blocks code: yes, for setlist work.
  Source: `src/modules/Setlist/useCases/setlist/goToItem.ts:11-31`.
- **loopStation layers are placeholders** (no audio capture wired). Options:
  spec the looper capture path vs remove the placeholder records. Blocks code:
  no. Source: `src/modules/SessionLauncher/useCases/loopStation/toggleRecord.ts`.
- **detectProjectTempo is stub-grade** — it re-detects the input tempo (one
  synthetic onset per beat at project tempo). Options: real onset detection vs
  remove the affordance. Blocks code: no. Source:
  `src/modules/Transport/useCases/tempoMapping/operations/detectProjectTempo.ts`.
- **Handler-map shape-spec convention: `getSetlistHandlers` has none.**
  `getTransportHandlers` gained a map-shape spec (asserts every command handler
  is present with an `execute`, and that the returned map is freshly built),
  while the spun-out `Setlist` module's `getSetlistHandlers` never had one.
  Options: adopt a convention that every `get<Module>Handlers` map carries a
  shape spec (backfill Setlist first) vs treat coverage case-by-case. Blocks
  code: no. Source: `src/modules/Setlist/useCases/getSetlistHandlers.ts` (no
  `__tests__` spec),
  `src/modules/Transport/useCases/__tests__/getTransportHandlers.spec.ts`
  (precedent).
  **RESOLVED 2026-07-18 (#428): `getSetlistHandlers` map-shape spec added at the `getTransportHandlers` precedent depth (`src/modules/Setlist/useCases/__tests__/getSetlistHandlers.spec.ts` — asserts each key + `.execute`, fresh map). `getTransportHandlers` already carried one, so the convention is now uniform. ADR-0011 W7.**

## Command

- **Retire or keep the `AppAction` dispatch contract.** After ADR 0007 the
  contract lives in `src/utils/handlerContract.ts` (type-imported repo-wide, mirrored by
  AiRuntime); whether it should be retired in favor of the registry/query
  surface is open, as is whether undo-tree branch switching should
  traverse/replay or stay bookkeeping. Options: keep AppAction as canonical
  contract vs migrate consumers. Blocks code: no, but shapes every new action.
  Source: `src/utils/handlerContract.ts`,
  `useCases/undoTree/branchOperations/switchBranch.ts`; ADR 0007.
- **Canvas-editor Delete routing for non-focusable editors.** The
  `data-canvas-editor` gate works for PianoRoll (focusable canvas) but cannot
  reach the Elastic editor (window-level keydown, non-focusable canvas — its
  Delete double-fires with global clip-delete) and would regress the Mixer
  (no local Delete). Options: editor-local `stopImmediatePropagation` vs an
  "editor-open" flag in the contract; confirm whether Mixer focus should
  swallow clip-delete at all. Blocks code: yes, for the Elastic double-fire
  fix. Source:
  `src/modules/CommandInterface/presentations/views/keyboardShortcutsContract.ts`,
  `src/modules/ElasticAudio/presentations/views/ElasticEditorPanel.tsx:113-139`,
  `src/modules/Workspace/presentations/views/MixerPanel.tsx`.
- **Themed rename-prompt mechanism (product/UI).** Palette track/clip rename
  still uses native `window.prompt`; no reusable themed string-prompt exists.
  Options: a generic `dialog.openTextPrompt` event + dialog component vs
  inline-rename surfaces (MacrosPanel pattern); fold trimmed/non-empty
  validation into whichever is chosen. Blocks code: yes, for rename UX work.
  Source: `src/modules/CommandInterface/useCases/commands/TrackCommands.ts`,
  `src/modules/CommandInterface/useCases/commands/ClipCommands.ts` (post-ADR-0007),
  `src/modules/Workspace/presentations/views/Sidebar/MacrosPanel.tsx`.
- **No global `unhandledrejection` handler for `executeAppAction`.** Nothing in
  `src/` registers a `window.unhandledrejection` / `onunhandledrejection`
  handler (grep-confirmed zero registrations), so a rejected promise escaping an
  `executeAppAction` dispatch surfaces only as an unhandled rejection with no
  app-level recovery or telemetry. Options: add a global handler (report +
  user-facing recovery) vs accept silent rejections; the prior tracking artifact
  was retired without replacement — recorded here. Blocks code: no. Source: grep
  — zero `unhandledrejection` registrations under `src/`;
  `src/modules/Command/useCases/executeAppAction.ts`.

## BrowserAi

- **renderQueueStore key mismatch.** `cachedPhraseIds` is keyed by cacheKey
  while `phraseStatusMap` is keyed by phraseId, so there is no path to ask
  "is this phrase's cached audio still on disk?". (The old unbounded-entries
  premise is resolved: `markRenderComplete` now drops completed entries.)
  Options: unify keying vs accept the split. Blocks code: no. Source:
  `src/modules/BrowserAi/stores/renderQueueStore.ts:22-24,72-79`.
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
  no. Source: `src/modules/ControlSurface/useCases/midiLearn/midiLearnDependencies.ts`.
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
- ~~**Trust model for controller scripting.**~~ **Closed 2026-08-12 (#1746):**
  the isolated `new Function()` Worker had no production importer and was deleted
  before shipment. Any future scripting feature must establish a new sandbox,
  permission, and message-validation contract rather than revive the removed
  surface. Blocks code: no.
- **Ratchets / step-conditions**: undocumented pattern-logic gap (MidiNote has
  probability only). Options: add fields vs declare out of scope. Blocks code:
  no. Source: `src/modules/MIDI/models/MidiNote.ts`.
- **MIDI correctness spec home.** The prior audit's goal (note
  pairing/ordering, edit invariants, behaviour-asserting tests) has no spec on
  disk. Options: write `SPEC-MIDI` vs fold into module docs. Blocks code: no.
  Source: provenance `INV-MIDI` (no code locus).
- **webMidiStore placement: promote to `MIDI/stores` or keep the useCases
  re-export?** The store is defined in the repository layer
  (`repositories/webMidi/store.ts`) and surfaced through a use-case helper
  re-export (`useCases/webMidiInput/helpers.ts` → `useCases/index.ts`), a
  pre-existing pattern carried through the #413 ControlSurface split. Options:
  promote it to a real `MIDI/stores/` public read contract vs keep the
  repository store plus useCases re-export. Blocks code: no. Source:
  `src/modules/MIDI/repositories/webMidi/store.ts`,
  `src/modules/MIDI/useCases/webMidiInput/helpers.ts:9`,
  `src/modules/MIDI/useCases/index.ts:118`.
  **RESOLVED 2026-07-18 (#428): promoted to `src/modules/MIDI/stores/webMidiStore.ts` (barrel-exported public read contract); `repositories/webMidi/store.ts` kept as a thin sync adapter that seeds + subscribes (the store may not import `repositories/` or the Tauri bridge — `usecases-only-write-boundary-to-repositories` / `desktop-ipc-only-in-repositories`). `useCases/webMidiInput/helpers.ts` removed; importers repointed to `#/modules/MIDI/stores`. ADR-0011 W7.**

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
  `src/modules/CvGate/useCases/cvOutputOperations/setCvValue.ts:11`,
  `src/modules/CvGate/useCases/cvConversion/midiNoteToCv.ts:16`.
- **cvGate `triggerPulseMs`/`gateThreshold` are persisted but dead** — defined,
  validated, and stored with zero production consumers. Options: wire them
  into the gate path or delete the fields. Blocks code: no. Source:
  `src/modules/CvGate/stores/cvGate.ts:29-30,37-38,45`.

## CrdtDocument

- **actionHistoryStore is CRDT-backed under root**: each action mutates root
  twice (state + history) and history syncs to all peers, contradicting the
  per-user assumption in revertAction UX / AiActionHistoryPanel. Options:
  per-user local history vs shared synced history by design. Blocks code:
  yes, for collaboration + undo-history work. Source:
  `src/modules/CrdtDocument/stores/actionHistoryStore.ts:21-22`,
  `src/modules/Collaboration/useCases/automergeSync.ts`.

## Workspace

- **Bottom-dock default arm silently routes unknown tabs to
  `<RoutingMatrix/>`** — an 11th union value would route there unflagged.
  Options: exhaustive switch with `never` check vs keep the fallback. Blocks
  code: no. Source:
  `src/modules/Workspace/presentations/views/AppShell.tsx:456-457`.
- **Should bottomTab persist?** It is local `useState`, lost on reload.
  Options: move into workspaceStore vs session-only by design. Blocks code:
  no. Source: `src/modules/Workspace/presentations/views/AppShell.tsx:179-183`.
- **SessionView slot launch plays nothing** — writes only sessionLaunchStore;
  no Transport/engine call (store documents engine wiring as deferred).
  Options: wire clip launch to the engine vs hide the surface until then.
  Blocks code: yes, for session-view work. Source:
  `src/modules/SessionLauncher/presentations/views/SessionView.tsx:33-41`,
  `src/modules/SessionLauncher/stores/sessionLaunchStore.ts`.
- **Thread `audioBufferId` (not `clip.id`) through `WaveformEditor`.**
  `WaveformEditor` keys peaks, warp state, and AI-denoise on the `clipId` prop
  (`presentations/views/ClipView/WaveformEditor.tsx:91,500`), which `ClipView`
  passes as `selectedClip.id` (`ClipView.tsx:125`); the denoise pipeline now
  keys on `clip.audioBufferId` (fixed in PR #315 for the Inspector +
  context-menu entry points). The parent must thread `audioBufferId` — a
  follow-up refactor (a `realClipId` reconciliation at
  `WaveformEditor.tsx:366-369` already covers only normalize/reverse). Blocks
  code: no. Source: `WaveformEditor.tsx:91,366-369,500`,
  `src/modules/Workspace/presentations/views/ClipView.tsx:125`.
- **Wire or retire Workspace `automationSubLanes`.** The sub-lane mutators
  (`useCases/automationSubLanes/{addAutomationSubLane,removeAutomationSubLane,swapAutomationSubLaneParam}.ts`
  + `helpers.setAutomationSubLanes`) have zero production callers and are not
  exported from the Workspace `useCases` barrel, so `workspace.automationSubLanes`
  can never be populated at runtime; the Arrangement reader
  `hitTestAutomationSubLane` (wired via
  `Arrangement/presentations/helpers/timelineTools.ts:133,173`) hit-tests an
  always-empty map. Wire an add-sub-lane command/UI, or retire the feature.
  Blocks code: no. Source:
  `src/modules/Workspace/useCases/automationSubLanes/`,
  `src/modules/Arrangement/useCases/timelineInteractions/hitTestAutomationSubLane.ts:27`.
- **Wire-format naming drift: Workspace persists `scoring*` for the Tuner
  module.** After the Scoring→Tuner rename the module is `Tuner`, but Workspace
  still names the persisted field `scoringHeight`, the device-panel discriminant
  `kind: 'scoring'` / `scoringDeviceId`, and the event `panel.showScoring`,
  while rendering `<TunerPanel/>`; the `scoring` wire tokens were kept for
  persistence stability. Options: migrate the persisted/event tokens to `tuner*`
  (needs a WorkspaceState migration) vs make `scoring` a permanent stable alias.
  Blocks code: no. Source:
  `src/modules/Workspace/models/WorkspaceState.ts:54,104`,
  `src/modules/Workspace/presentations/hooks/useActiveDevicePanel.ts:43,85`,
  `src/modules/Workspace/presentations/views/AppShell.tsx:216,629`.
  **ACCEPTED-INTENTIONAL 2026-07-18 (#428): keep the `scoring*` wire tokens as permanent stable aliases — renaming serialized fields breaks existing save files for zero user value. No code change. ADR-0011 W7.**

## Collaboration

- ~~**Host auto-grants editor to every connecting peer**~~ — **closed by ADR 0016
  ruling 4.** Answered as deliberate open-by-default: the role scaffold is
  deleted and an invite is documented as unconditional write access. No
  role-selection UX.
- ~~**Role-revocation semantics undefined**~~ — **closed by ADR 0016 ruling 4.**
  Moot: `PermissionManager` and its epoch/grant model no longer exist. The only
  way to revoke access is to end the session.
- **Is manual SDP copy-paste signaling permanent or a placeholder** for a
  signaling server (SignalingMessage types exist)? Blocks code: no. Source:
  `src/modules/Collaboration/models/CollaborationTypes.ts:51`.

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
  `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:169,251-252`.
- **Timeline zoom bounds**: pixelsPerBeat hardcoded to [2,80]; cannot zoom in
  for dense MIDI nor out for long arrangements. Options: widen/adaptive bounds
  vs keep. Blocks code: no. Source:
  `src/modules/Arrangement/stores/timelineViewStore.ts:26`.
- **Presentation hooks own undo entries.** `useTimelineInteractions.ts` authors
  undo directly from presentation (9 `pushUndoEntry` call sites, lines
  ~559-901) and `usePianoRollInteractions.ts` does the same; the inline-MIDI
  commits were already extracted to use cases (`commitInlineMidiNote*`).
  Options: extract the drag/resize/split commit paths the same way so use
  cases own their undo entries vs keep undo authored in the hook. Blocks code:
  no (M refactor). Source:
  `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts:559-901`,
  `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts`,
  `src/modules/Arrangement/useCases/timelineInteractions/commitInlineMidiNote{Create,Delete,Move}.ts`.
- **mixerSnapshotStore placement: defined under `useCases/`, not `stores/`.**
  `mixerSnapshotStore` is created in
  `useCases/mixerSnapshot/operations/helpers.ts` rather than a `stores/` file;
  ownership is correct (Arrangement) but placement is irregular against the
  store-layer convention. Options: relocate to `Arrangement/stores/` vs accept
  the useCases-local store. Blocks code: no. Source:
  `src/modules/Arrangement/useCases/mixerSnapshot/operations/helpers.ts:9`.
  **RESOLVED 2026-07-18 (#428): relocated to `src/modules/Arrangement/stores/mixerSnapshotStore.ts` (barrel-exported); the 5 operation importers + spec repointed via same-module relative path. ADR-0011 W7.**

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
  `src/modules/AudioEngine/engine/TrackNode.ts:202` (routeOutput).
- **NativePluginBridgeNode per-block IPC ceiling (architecture).** An async
  desktop-IPC `process_plugin_audio` call per audio block means per-block IPC
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
- **Worklet-support shared infra: relocate to `src/infra` or keep
  engine-private?** `engine/workletInitShared.ts` and the generated
  `wasm/daw_dsp.js` bindings are private AudioEngine infra consumed by 11 device
  nodes (GrandBoule, Gluten, Bacteria, Levain, Toaster, Scoring, Knead, Grinder,
  Fermenter, ProofChamber, Proof) plus the grandBoule engine worker. The
  repositories-no-business and cross-module-index-only walls block the next
  DSP-node extractions (ElasticAudio PR #415 probe evidence) until this seam
  becomes a shared surface. Options: relocate to `src/infra` / a shared
  worklet-support module vs keep it engine-private. Blocks code: no, but gates
  future device-node extractions. Source:
  `src/modules/AudioEngine/engine/workletInitShared.ts`,
  `src/modules/AudioEngine/wasm/daw_dsp.js`.
  **PARTIALLY RESOLVED 2026-07-18 (#428): `workletInitShared.ts` moved to `src/infra/audioWorklet/` (hand-written, zero-import, main-thread shared init — clean infra seam; engine→infra is an existing pattern). The generated `wasm/daw_dsp.js` bindings are KEPT engine-private: they are build artifacts written by `scripts/gen-*-worklet.ts` to a hardcoded `AudioEngine/wasm/` path and consumed by worklet-scope processors, so relocating them is a build-pipeline change, not a behavior-preserving move. ADR-0011 W7.**

## ElasticAudio

- **Warp-algorithm selection is stored but drives no DSP.** The per-clip
  `WarpAlgorithm` written by `setWarpAlgorithm` (via the `setWarpAlgorithm`
  AppAction / `handleSetWarpAlgorithm`) lands in `audioWarpStore.clipSettings`
  and is read only by the ElasticEditorPanel UI; no engine, worklet, scheduling,
  or offline-render path reads it to select a stretch algorithm (the sole
  cross-module consumer of `ElasticAudio/stores` is the write handler). The gap
  moved intact into ElasticAudio in #415. Options: wire the algorithm through to
  the time-stretch DSP vs remove the selectable-algorithm surface. Blocks code:
  no. Source: `src/modules/ElasticAudio/stores/audioWarp.ts:22-30`,
  `src/modules/ElasticAudio/useCases/audioWarping/setWarpAlgorithm.ts`,
  `src/modules/AudioEngine/handlers/finalFeature/handleSetWarpAlgorithm.ts`.

## GrandBoule

- **MidiPedalCcPayload is a non-discriminated `number|boolean` union**;
  consumers paper over with casts. Options: discriminated union vs split
  events. Blocks code: no. Source:
  `src/modules/Workspace/events/WorkspaceEvents.ts:59`.
- **SpectralWaterfall mutates the shared AnalyserNode** (`fftSize=512` on an
  AudioEngine-owned node). Options: per-view analyser vs documented shared
  config. Blocks code: no. Source:
  `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx:141`.
- **MIDI calibration never reaches the WASM engine** — calibration setters
  persist to store only, no `engine.setParam`. Options: wire the bridge vs
  declare calibration UI-only. Blocks code: yes, for calibration work.
  Source:
  `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setVelocityCurveExponent.ts`.
- **Pedal handler drops CC1/CC11/CC74** on a handler subscribed to all
  `midi.pedalCc` (only CC64/66/67 handled). Options: handle or filter the
  subscription. Blocks code: no. Source:
  `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:208-213`.

## Gluten

- **Per-module preset list by design?** GLUTEN_PRESETS + module-load-time
  CATEGORIES derivation vs deferring to an Arrangement preset library. Blocks
  code: no. Source: `src/modules/Gluten/useCases/glutenPresets.ts`,
  `presentations/views/GlutenPanel.tsx:153`.
- **Meter-path validation + error boundary**: raw worklet meter numbers are
  written to the store unvalidated and rendered directly; no panel error
  boundary. Options: validate at the registry sink vs trust the worklet.
  Blocks code: no. Source:
  `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:332-342`,
  `src/modules/Gluten/stores/glutenStore.ts:70-85`.
- **uiLevel (1..5) written but never read** — unfinished progressive
  disclosure? Options: build the disclosure UI vs delete the field. Blocks
  code: no. Source: `src/modules/Gluten/stores/glutenStore.ts:20,73-76`.

## Crust

- **No per-panel error boundary** — a Crust render fault tears down the whole
  app to the root fallback. Options: per-panel boundary policy (applies
  beyond Crust) vs root-only. Blocks code: no. Source:
  `src/modules/Workspace/presentations/views/AppShell.tsx` (CrustPanel mount),
  `src/modules/Workspace/presentations/components/ErrorBoundary.tsx`.
- **Dither offered at 32-bit float is a no-op** the UI does not signal.
  Options: hide dither at 32-bit vs annotate. Blocks code: no. Source:
  `src/modules/Crust/presentations/components/CrustControlZone.tsx:534-536`.

## Yeast

- **`MidiProcessor.latencySamples()` is a dead interface** — declared,
  defaulted to 0, overridden by nobody; MidiRack aggregates no latency for
  plugin-delay compensation. Options: implement PDC aggregation vs remove the
  method. Blocks code: no. Source:
  `src/modules/Yeast/workers/MidiProcessor.ts:43`,
  `workers/BaseMidiProcessor.ts:54`.
- **`Harmonizer.timeOffsetSamples` is permanently 0** (used in arithmetic, no
  setParam case sets it); ship intent undecided. Options: expose the param vs
  delete the field. Blocks code: no. Source:
  `src/modules/Yeast/workers/processors/Harmonizer.ts:22`.
- **Is `loopStart === loopEnd` the intended loop-disabled convention?** Both
  bridge and offline paths infer loopEnabled as `loopStart < loopEnd`,
  unconfirmed against transportStore. Blocks code: no. Source:
  `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:42`.

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
- **Is exportPatternToTimeline meant to be lossy or full-fidelity?** Blocks
  code: no. Source: `src/modules/Toaster/useCases/exportPatternToTimeline.ts:30-69`.
- **Is sequencer pause-and-resume a desired feature?** `stopSequencer` zeros
  playCount/currentStep so no playhead state survives a stop. Blocks code:
  no. Source: `src/modules/Toaster/useCases/stopSequencer.ts:20-22`.
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
  `src/modules/Bacteria/models/BacteriaPatch.ts:141,188-198`,
  `presentations/views/BacteriaPanel.tsx:457` (XYMorphPad mount).
  (Lab editors / ModulationDock drag-to-assign: see the "Unbuilt feature
  subsystems (finish-or-remove)" table above — the add path is gated on that
  same call.)

## VirtualKeyboard

- **Focus contract is undiscoverable**: notes fire only when the tabIndex=0
  panel is focused; no ready/focused indicator. Blocks code: no. Source:
  `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:518-519,560`.
- **Screen-reader accessibility**: `role="application"` panel with
  `role="button"` keys lacking tabIndex/keyboard activation. Options: proper
  ARIA/keyboard model vs declare pointer-only. Blocks code: no. Source:
  `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:523,680,721`.
- **No VirtualKeyboard spec** — the prior audit's prescriptive layer
  (release-all-on-unmount/visibility, event.code mapping, velocity-from-y,
  octave range) was never lifted into a spec. Blocks code: no. Source:
  module at `src/modules/VirtualKeyboard/` (no spec on disk).
- **triggerLiveNoteOff idempotency unverified**; no all-notes-off/panic use
  case exists for cleanup paths (StrictMode double-mount, onBlur+pointerup
  overlap). Blocks code: yes, for keyboard cleanup hardening. Source:
  `src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx:274,290`;
  no panic use case under `src/modules/AudioEngine/useCases/`.

## Tuner

- **Non-atomic read-merge-write races** between updateTunerTelemetry and
  setDisplayMode can lose a preference write. Options: keyed updates in the
  store vs accept the race. Blocks code: no. Source:
  `src/modules/Tuner/stores/tunerStore.ts:55-59`, `useCases/setDisplayMode.ts`.
  (`setA4Reference` no longer shares this race: the concert-A reference is a DSP
  input on `Device.parameterValues`, not `tunerStore` state.)
- **a4Reference bounds 400–490 exclude historical tunings** (392/415/466/500
  Hz). Options: widen bounds vs document the range. Blocks code: no. Source:
  `src/modules/Tuner/presentations/views/TunerPanel.tsx:162-163`.
- **Raw DisplayMode literal rendered to users** (lowercase `detail={mode}`),
  inconsistent with human labels elsewhere. Blocks code: no. Source:
  `src/modules/Tuner/presentations/views/TunerPanel.tsx:123,265`.

## AiRuntime

- **PayloadValidator predicate bodies are unverifiable by TS** — the
  `satisfies Record` guards only the map shape; multiple validators silently
  drift from payload types (systemic). Options: schema-derived validation
  (Zod per action) vs hand predicates + tests. Blocks code: yes, for action
  contract growth. Source:
  `src/modules/AiRuntime/useCases/validateActionPayload.ts:121,477-478`.
- **"Handler already validates trackId" is an unverified justification** for
  ~70% "unchecked" actions (removeAllTracks, exportDawProject, loadPreset,
  generate*, stemSeparate) — no test or compile-time linkage. Needs an
  investigation pass. Blocks code: no. Source:
  `src/modules/AiRuntime/useCases/validateActionPayload.ts:477` (PAYLOAD_VALIDATORS, ~194 'unchecked' entries).
- **Wire or retire `musicMentor.getMentorTip`.** The singular `getMentorTip`
  query has zero non-test callers (referenced only by its own spec) — distinct
  from the plural `getMentorTips` handler, which *is* wired
  (`handlers/aiOrganization/handleGetMentorTips.ts`,
  `src/modules/CommandInterface/useCases/commands/AiCommands.ts:203`). Wire the tip query
  into a surface or delete it. Blocks code: no. Source:
  `src/modules/AiRuntime/useCases/musicMentor/queries.ts:8`.

## Project

- **Are demo projects meant to be deterministic/regenerable from a seed?**
  They mutate global stores with interleaved async setup; rapid double-launch
  can race. Blocks code: no. Source:
  `src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts`.
- **localStorage quota policy + recent-list lifecycle**: policy for
  legacy/oversized projects exceeding quota, and whether recentProjects should
  survive project deletion (newProject does not clear the list). Blocks code:
  no. Source:
  `src/modules/Project/useCases/projectPersistence/newProject.ts:75`.
- **autoSaveVersion has no production caller** (only CRDT autosave is wired).
  Options: wire version-control autosave vs remove. Blocks code: no. Source:
  `src/modules/ProjectVersioning/useCases/versionControl/autoSaveVersion.ts:5`.
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

- **Web build: bridge calls silently void with no real audio** — E2E
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
  `crates/sourdaw-native/src/commands/crumbs.rs`.

## Knead

- **Canonical owner of the knead-clip schema and PitchContour.** Five forks
  disagree on fields (Knead wide store shape vs Arrangement/Project narrow
  persistence vs worklet blob; PitchContour `algorithm` optional in Knead,
  required in AudioEngine), with `as` casts fabricating undefined fields
  either way. Decide the owning module, whether the narrow persistence subset
  is intentional, and whether `originalPitchCenterCents` must be persisted.
  Blocks code: yes, for any Knead schema work. Source:
  `src/modules/Knead/stores/kneadStore.ts:26-53`,
  `src/modules/Arrangement/models/Track.ts:125-139`,
  `src/modules/Project/models/ProjectData.ts:397`,
  `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts`.

## SampleLibrary

- **Library-root identity across reconnects**: path vs content hash vs seeded
  UUID (today a random `lib-<uuid>` per connect duplicates roots). Blocks
  code: yes, for library persistence. Source:
  `src/modules/SampleLibrary/useCases/connectFolder/connectFolder.ts:19,52`.
- **Preview-stop ownership**: should stop-on-unmount/folder-change live in
  LibraryBrowser or Workspace.usePreviewAudio? Today audio keeps playing after
  the sample is no longer visible. Blocks code: no. Source:
  `src/modules/SampleLibrary/presentations/views/LibraryBrowser.tsx`.
- **audioBufferCache ownership + push-vs-pull** for SampleLibrary buffers
  (an LRU cap is now implemented in the store; the open call is which module
  owns the cache contract and whether SampleLibrary pushes or pulls). Blocks
  code: no. Source: `src/modules/AudioEngine/stores/audioBufferCache.ts:64-107`,
  `src/modules/SampleLibrary/useCases/seedFactoryLibrary.ts:108`.
- **Where does the audio-decoding pipeline live** (browser OfflineAudioContext
  vs native reads)? Still split: timeline drag-in decodes via the AudioEngine
  `decodeAudioFile` use case while sample preview decodes inline with
  `ctx.decodeAudioData`. Blocks code: yes, for decode consolidation. Source:
  `src/modules/Arrangement/presentations/hooks/useTimelineFileDrop.ts:192`,
  `src/modules/Workspace/presentations/hooks/usePreviewAudio.ts:106`.
- **Is the factory library shipped or experimental?** Decides how much
  first-launch cost is acceptable: factory samples are synthesized on the main
  thread during app initialization (now chunked with event-loop yields, but
  still startup work). Blocks code: no. Source:
  `src/modules/SampleLibrary/useCases/seedFactoryLibrary.ts:101-108`,
  `src/modules/Workspace/presentations/hooks/useAppInitialization.ts:94`.

## SoundLibrary

- **Delete the orphaned module or revive it (human call).** SoundLibrary is
  fully orphaned since commit e4b31ed8b (2026-06-30) routed the sample-search
  action to SampleLibrary — zero files outside `src/modules/SoundLibrary/`
  import it (`grep -rn "modules/SoundLibrary" src/ | grep -v
  "src/modules/SoundLibrary/"` returns nothing; the only residual mention is a
  stale doc-comment in
  `src/modules/Arrangement/repositories/presets/factoryPresets.ts:95`). Its
  `stores/`, `events/`, and `useCases/` barrels have no external consumers.
  Options: delete the whole module vs revive it behind a real surface —
  deleting an entire module is a human decision, not an agent one. Blocks
  code: no (dormant). Source: `src/modules/SoundLibrary/` (orphaned tree),
  commit e4b31ed8b.

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
  `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts:95` (and
  sibling handlers).
- **Scale-theory interval tables triplicated within AiGeneration.** Three
  independent interval-table definitions coexist: `models/MidiPatternType.ts`
  (`SCALE_INTERVALS`, consumed by `services/scaleTheory.ts`),
  `useCases/generateMelody/algorithm.ts` (its own `SCALE_INTERVALS`), and
  `useCases/generateChordProgression/algorithm.ts` (its own
  `MAJOR_SCALE_INTERVALS` / `MINOR_SCALE_INTERVALS`) — the #395 move
  consolidated none of them. Options: consolidate to one shared table vs accept
  per-generator copies. Blocks code: no. Source:
  `src/modules/AiGeneration/models/MidiPatternType.ts`,
  `src/modules/AiGeneration/useCases/generateMelody/algorithm.ts:60`,
  `src/modules/AiGeneration/useCases/generateChordProgression/algorithm.ts:54-55`.
  **ACCEPTED-INTENTIONAL 2026-07-18 (#428): keep the per-generator copies — the three tables are keyed by three distinct `ScaleType` domains (`MidiPatternType` 7 scales incl. `pentatonic-minor/major`; `GenerationStyles` 14 scales incl. `pentatonic`/`minor-pentatonic`/modes; chord-progression `'major'`/`'minor'` only), not byte-similar duplicates. Consolidating forces unifying incompatible unions and changes supported-scale sets (semantic drift). No code change. ADR-0011 W7.**

## Proof

- **Designated pattern for ~60Hz meter store updates under React Compiler** —
  the unified-map store spreads the whole instances map per tick. Options: a
  sanctioned high-rate-telemetry store pattern (selectors/refs/SAB-read) vs
  accept. Blocks code: yes, for meter-heavy modules (Proof, Bacteria share
  it). Source: `src/modules/Proof/stores/proofStore.ts:179-186`.
- **Should uiLevel/abBypass persist in the project patch?** Session-scoped
  today, absent from ProofPatch. Blocks code: no. Source:
  `src/modules/Proof/stores/proofStore.ts:33,47`.
- **Preset LUFS values need DSP review**: 'cd' targets −9 (CD practice is
  nearer −12), 'club' and 'loud' both land at loud targets (possible UI
  double-listing). Blocks code: no. Source:
  `src/modules/Proof/useCases/proofPresets.ts:37,43,87`.
- **Project-wide i18n**: no framework exists; externalizing hard-coded UI
  strings (e.g. Proof preset target labels) requires adopting one first.
  Options: adopt i18n vs English-only for now. Blocks code: no. Source:
  `src/modules/Proof/useCases/proofPresets.ts`; no i18n dependency in
  `package.json`.
- **Unify the Proof persist + engine-write path (spec-level).** Rehydration is
  fixed — `proofParamBridge/syncFullPatch.ts` `rehydrateRestoredPatch` restores
  the full patch on reload — but there is still no single unified persist +
  engine-write path: `proofParamBridge/setProofParam.ts` persists one param on a
  separate path. Redesign to one source of truth + one write path. Blocks code:
  no. Source: `src/modules/Proof/useCases/proofParamBridge/syncFullPatch.ts`,
  `useCases/proofParamBridge/setProofParam.ts`.
- **Proof vs `Plugin/proofChamber` duplication (I-25).** Two live surfaces
  model "the proof chamber" — `src/modules/Proof/` and the surface
  historically at `src/modules/Plugin/useCases/proofChamber/`, since extracted
  to the standalone `src/modules/ProofChamber/` module (Plugin-lane path left
  as-is pending the in-flight PluginHost rename). Product decision on the owner;
  surface to the maintainer, do not delete code unilaterally. Blocks code: no.
  Migrated from ADR-0010 Open questions. Source: `src/modules/Proof/`,
  `src/modules/ProofChamber/` (was `Plugin/useCases/proofChamber/`).
- **ProofChamber user-preset repos are dead** — `saveUserPreset`,
  `deleteUserPreset`, and `importPresetJson` (plus `writeUserPresets`) under
  `ProofChamber/repositories/proofChamberPresets/` have zero production callers
  and are exposed through no module barrel. Options: wire a preset
  save/delete/import surface vs delete the repos. Blocks code: no. Source:
  `src/modules/ProofChamber/repositories/proofChamberPresets/` (saveUserPreset,
  deleteUserPreset, importPresetJson, writeUserPresets). **RESOLVED 2026-07-18 (#427): dead repos deleted (ADR-0011 W7).**

## Automation

- **Automation lane addressing lacks a device id**: applyAutomation writes
  only the FIRST device on a track exposing the parameter; two devices with
  the same parameterId cannot both be automated. Options: add deviceId to the
  lane model vs first-match by design. Blocks code: yes, for multi-device
  automation. Source:
  `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts:81-126`.
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

- **handleAudioToMidi contract**: the handler silently coerces `mode` via
  `normalizeAudioToMidiMode`, and the AppAction advertises `mode?: string`
  instead of a discriminated union (the once-advertised
  `targetPitch`/`minInterval` params are gone from the payload type).
  Options: honest narrow contract vs full param support. Blocks code: no.
  Source:
  `src/modules/AudioAnalysis/handlers/analysis/handleAudioToMidi.ts:14-20`,
  `src/utils/handlerContract.ts` (the `AppAction` type; was `Command/models/AppAction.ts:314`).
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


## Project persistence (ADR 0014, proposed)

Decisions the architecture cannot be chosen without. Evidence:
`.agents/artifacts/sourdaw/RESEARCH-project-persistence.md`. Each changes what a project file *is*
or how a user moves work between machines, which is why none of them is engineering's to make.

- ~~**Is a project one file, or a folder?**~~ **DECIDED 2026-08-02 — a folder, with a
  content-addressed document.** Recorded in ADR 0014 §Owner decisions taken. Settled by the standard
  the campaign is held to rather than by preference: gate M6 tore the layout as originally drawn
  (6 of 72 injected crashes opened as a project that was neither generation, one of them with 52
  tracks where the two real saves had 40 and 64), and content-addressing the document took that to
  0 of 72. Git's object store, SQLite's WAL and atomic-rename-and-fsync all work this way. The
  portable form is still a ZIP.
- ~~**Does a project file contain its audio, or reference it?**~~ **DECIDED 2026-08-04 — per asset,
  and the web writer always embeds.** Recorded in ADR 0014 §Ratified 2026-08-04. It is two answers,
  so the format expresses both: an embed-or-reference mode on each asset, `embed` from the web,
  `reference` available to the deferred desktop build with no format change. Convention gives the
  desktop half — all four shipping DAWs default to reference with explicit consolidation, and
  DAWproject already makes it a per-file attribute, which is the shape `SPEC-dawproject-interchange`
  needs regardless. Convention does not give the web half, because reference-by-path has no working
  web form: a File System Access handle persists in IndexedDB but needs `requestPermission()` in
  each new session, so a sixty-sample project prompts per file on every reload. Accepted costs: two
  reader paths from day one, a *consolidate* action owed on the writer, and a shared sample
  duplicated per project — that last one is the separate library question below, not this one.
- ~~**May browser-resident storage ever be described as "safe"?**~~ **DECIDED 2026-08-02 — no.
  Browser storage is a cache, never the authority.** The authoritative copy is a file the user
  controls, written through the File System Access API and kept in sync. Recorded in ADR 0014
  §Owner decisions taken. The grounds are the Storage Standard, exactly as this entry originally
  stated them: §7.1 has the user agent offer to clear even `persistent` buckets under continued
  pressure, and §5 protects them only by requiring user involvement. ADR 0012 then settles it — a
  desktop project file has no equivalent failure mode.
- ~~**Is "install the app" a stated durability requirement?**~~ **DECIDED 2026-08-02 — no, for the
  spec reason above rather than anything about installing.** Chrome's documented grant heuristics
  *do* include installation, alongside site engagement and notification permission
  ([web.dev](https://web.dev/articles/persistent-storage)). A gate-M1 probe reported `persist()`
  false even for an installed PWA, but it ran on a throwaway profile with no history and installed
  via CDP, so it measured its own fixture; **that result is withdrawn.** The answer does not depend
  on it: even a granted persistent bucket cannot be described as safe, so install cannot be the
  durability story whether or not it is obtainable.
- ~~**Does a project's audio belong to the project, or to a shared library?**~~ **DECIDED
  2026-08-04 — the project owns it; the library is a browse-and-import source, never a runtime
  dependency.** Importing copies in. "Is this sample safe to delete?" is answered by deleting the
  project directory, with no cross-project scan — and the scan is the operation that gets skipped
  and turns into either a silent leak or a project broken by a freed blob. This is what every
  shipping DAW does (Ableton's per-project Samples folder beside a User Library, Logic's package
  beside its Loops library), and it is coherent with the per-asset embed ruling above, since an
  embedded asset is a copy by definition. **Accepted cost:** a shared library used by ten projects
  is duplicated ten times on disk. openDAW's global content-addressed pool was considered and not
  taken; the refcounted hybrid was rejected as needing its own fault-injection gate before it could
  be trusted, since a drifted refcount either leaks disk silently or frees audio still in use.
- ~~**Version policy, and the web escape hatch.**~~ **DECIDED 2026-08-04 — forward-only, with no
  retained pre-migration generation.** Newer opens older; older refuses newer; migration rewrites in
  place. Strict industry convention, and the simplest thing to implement and reason about.

  **The cost was stated before the call and accepted: there is no recourse after a bad migration.**
  A web user cannot install the previous build, so unlike on desktop a migration bug reaches
  everyone at once with no way back for work already migrated. Retaining the previous generation was
  recommended and declined — ADR 0014's content-addressed layout would have made it close to free,
  since the old document is a differently-named file that migration need only not delete. Recorded
  here so that if a migration does go wrong, the absence of a fallback is a known accepted risk and
  not a surprise. **What would change this:** the first migration that has to touch existing
  projects is the point to re-examine it, and doing so is not re-litigation.
- **How much budget the desktop store gets.** ADR 0012 is accepted and Option C is what compliance
  costs. Option B is materially cheaper and violates it. If the budget is not there, the honest move
  is to amend ADR 0012 explicitly and choose B — not to adopt C and under-build it.

## Whole-application remediation (SURVEY-ultracode-scope)

From `.agents/artifacts/sourdaw/SURVEY-ultracode-scope.md` §3 — 134 verified findings, and these are
the calls an agent may not make alone. Several overlap the finish-or-remove table above; where they
do, that table is the record and this list is the pointer.

- **Gluten's +6.31 dB round-trip gain** (`crates/daw-dsp/src/gluten/oversample.rs:27`). Fixing it
  makes every existing mix using FET or Diode topology — including the shipped "Punch" preset —
  about 6 dB quieter and differently coloured. Fix / fix-plus-version-gated-legacy-gain / leave.
- **Knead's 2048-sample latency** (`crates/daw-dsp/src/knead/engine.rs:139`), reported to PDC as
  zero. Reporting it shifts every other track by up to ~43 ms; three shipped templates put Knead on
  vocals, and users may have hand-nudged to compensate.
- **Turning on offline automation for the five effects.** Every export made to date silently omitted
  it. Correct, but a user who mixed into a frozen-parameter bounce hears something different.
  Decide whether the first export of a pre-existing project warns.
- **Restoring device state that was previously lost** — Levain's instrument, Fermenter's layers,
  Crumbs' sample and pads, Toaster's `engineParams`. A reopened project currently plays defaults;
  after the fix it plays what was saved, which for a project developed *since* the loss is something
  the user has never heard.
- **Native plugin hosting: ship or gate.** Unreachable today via two independent mechanisms (the ACL
  grants 3 of ~78 commands; `start_native_engine` has no caller). Shipping is an XL transport
  rework; gating removes VST/AU/CLAP as an advertised capability.
- **Capabilities to remove or build.** Crust, CvGate, RAVE, Bacteria's
  three dead distortion modes, Levain's macros and mic strips, Proof's linear-phase EQ, Crumbs' pads
  and slices, Toaster's internal sequencer. Each removal deletes something a user may have
  configured and persisted. Several are cheaper to *build* than the survey assumed — the DSP already
  exists and is simply never instantiated.
- **Collaboration posture.** Build host-side admission and roles, or delete the role model and
  document that an invite string is unconditional write access. Leaving it guarantees the next
  feature built on it believes it enforces something.
- ~~**Model integrity policy.**~~ **DECIDED 2026-08-04 — verify every digest that exists, log its
  absence, and require a digest on every catalog entry added from now on.** The digest-less set is
  therefore closed and shrinks as entries are backfilled, rather than growing.

  **This matches how the web actually behaves, which is the opposite of the justification this
  entry originally carried.** Subresource Integrity performs **no check at all** when `integrity` is
  absent — resources load normally — and requiring the attribute needs an explicit `Integrity-Policy`
  response header to opt in ([W3C SRI](https://www.w3.org/TR/sri-2/),
  [MDN Integrity-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Integrity-Policy)).
  So failing closed on absence is *stricter than the ecosystem*, not the default, and the survey's
  earlier claim that HuggingFace Hub, ONNX tooling and SRI treat a missing digest as an error is
  wrong and was not used as justification. The shape adopted here is deliberately SRI's own: verify
  what is declared, and make the requirement explicit for anything new.

  **Accepted cost:** existing entries stay unverified until backfilled, and that backfill has to
  actually happen — it is not implied by this decision. Failing closed today was considered and
  declined because no catalog entry carries a digest, so it would break every model install; choosing
  it would really have been choosing to complete the backfill first.

## RESOLVED 2026-08-01 by ADR 0016

Four rulings that close a large part of the docket above. Recorded here so the entries are not
re-litigated; ADR 0016 is the record.

- **Native plugin hosting: ship or gate** — neither. **Desktop is out of scope** for this work
  entirely, and the plugin host is a desktop concern. Survey Phase 4 is dropped. The findings stay;
  the work is deferred.
- **Unbuilt feature subsystems (finish-or-remove)** — **finish, wherever it can run in the browser.**
  That is the scope rule now, and it replaces the per-row finish-or-remove call for every
  browser-capable entry in the table above. RAVE carries an unproven premise: establish that its
  models run in-browser at acceptable cost before committing to a shape. Rows
  whose home is native — the native CRDT backend, Push hardware, MIDI hardware controllers — follow
  the desktop deferral.
- **Correctness versus existing mixes** — **there are no users; correctness wins outright.** No
  compatibility shims, no version-gated legacy behaviour. This answers Gluten's +6.31 dB, Knead's
  latency, turning on offline automation, and restoring lost device state, and it collapses the
  ADR 0014 owner decisions that assumed existing projects had to be preserved.
- **Collaboration transport-permission** — **delete the scaffold.** Remove the unreachable role
  machinery and document that an invite string is unconditional write access.
