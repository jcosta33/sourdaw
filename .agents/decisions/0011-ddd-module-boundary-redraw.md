---
type: adr
id: 0011
title: DDD module boundary redraw — decompose god-modules into a 54 bounded-context set
status: accepted
date: 2026-07-17
owner: The Sourdaw team
sources:
    - src/modules (34-module structural index, 2026-07-17)
    - .dependency-cruiser.cjs
    - CLAUDE.md
    - '~/.agents/artifacts/sourdaw/INV-module-boundaries.md (working inventory)'
    - '~/.agents/artifacts/sourdaw/CHANGE-module-decomposition.md (working change plan)'
---

# 0011 — DDD module boundary redraw — decompose god-modules into a 54 bounded-context set

## Context

The codebase carries 34 domain modules (3202 prod files, 231.6k LOC), but mass and
coupling concentrate in seven god-modules that fuse unrelated bounded contexts:
Workspace (367 files, imports 31 of 33 other modules), Arrangement (545 files, 286
use cases), AudioEngine (456 files, 130 repositories, 10 disjoint-language stores),
plus Transport, Command, Plugin, Project, and AiRuntime. A whole-tree DDD mapping
(evidence-bound, adversarially reviewed) found concrete boundary defects, not just
size:

- Clip selection (arrangement truth) lives in layout state (`Workspace/models/WorkspaceState.ts:30-32`), sustaining a bidirectional Arrangement↔Workspace edge.
- `WarpMarker` is defined twice (Arrangement + `AudioEngine/stores/audioWarp.ts`) — one language, two owners.
- Scene/slot launcher language is split across a module boundary (Workspace `sessionLaunchStore` + Transport `loopStationStore`).
- Setlist owns its own event bus — a distinct aggregate, not a facet of a performance theme.
- Pitch-edit truth is split three ways (Knead / Arrangement / Command) with an `AudioEngine → Knead` upward type import.
- Several store-owning subsystems (live capture, routing-matrix, mixer-snapshots) have no single documented owner.
- SoundLibrary is dead (0 importers); Extension is dormant and exposes `executeAppAction` without a sandbox.

The full evidence map is the working inventory; the staged plan is the working
change plan (both under `~/.agents/artifacts/sourdaw/`). This ADR records the
durable decision so it survives independent of those transient artifacts.

## Decision

Redraw module boundaries so **each module owns one aggregate and speaks one
ubiquitous language**, decomposing the god-modules into a **54-module target set**.
Governing principles:

1. **Subdomain kind.** `core` = product-differentiating aggregates; `supporting` = necessary non-differentiating capability orbiting a core; `generic` = buy/borrow infrastructure with no domain.
2. **Aggregate-per-store, applied symmetrically.** A context is minted only where it owns a distinct store/aggregate AND speaks a language foreign to its host. The same rule that splits AudioEngine's satellites forbids fusing distinct aggregates into a theme.
3. **One language = one owner.** Duplicated languages collapse to a single owner with the other side as a read-client (WarpMarker→Arrangement; pitch-edit→Knead; document-branch→CrdtDocument low-level, ProjectVersioning user-facing via contract).
4. **Presentation is a layer, not a context.** Cross-aggregate view surfaces that own no aggregate become `supporting` presentation projections (TimelineEditor, MixerConsole, ContentBrowser), explicitly allowed to be wide downstream readers so core aggregates keep clean outbound edges. Metering is the one presentation split with its own visual language; its compute stays in AudioEngineCore.
5. **State ownership is exhaustive; no new cycles.** Every store has exactly one owner; extracted contexts consume their former host as a downstream client. High fan-in kernels (Command, AudioEngineCore, MIDI note aggregate, CrdtDocument) are correct shared kernels — inbound coupling is the crossing concept, not a smell.

**Target set (34 → 54), by transformation:**

- **Workspace →** WorkspaceShell (composition root; +VirtualKeyboard) + TimelineEditor + MixerConsole + Metering + ContentBrowser + SessionLauncher + Onboarding + Preferences; routing-matrix → Routing; DialogService → `src/infra`.
- **AudioEngine →** AudioEngineCore (graph+DSP+cache+capture+metering-compute) + ControlSurface + ControlRoom + AudioRendering + ElasticAudio; RAVE→BrowserAi; AbletonLink→Transport; WebMIDI note-input→MIDI; NativeAIBridge→AiGeneration.
- **AiRuntime →** AiRuntime + Voice + MixAdvisor; Pattern Library → AiGeneration.
- **Command →** Command (kernel+undo+undoTree+macros) + CommandInterface (palette+shortcuts); pitch-edit → Knead.
- **Project →** Project + ProjectVersioning + DawInterchange; AudioExport → AudioRendering; song-structure → AudioAnalysis.
- **Plugin →** PluginHost + ProofChamber; Push → ControlSurface; midiEffectPlugins → MIDI; nodeView → Routing.
- **Automation →** Automation + Modulation. **Synth →** Synth + CvGate. **SampleLibrary** absorbs dead SoundLibrary; **FactorySynthesis** extracted. **AudioAnalysis** absorbs stem-separation + song-structure. **Transport** yields Setlist + PunchRecording; SessionLaunch + LoopStation merge into SessionLauncher.
- **Renames/merges:** Scoring → Tuner; VirtualKeyboard → WorkspaceShell.
- **Kept whole (one aggregate each):** Arrangement, Transport, MIDI, Knead, CrdtDocument, Collaboration, BrowserAi, and the 11 device contexts (Fermenter, Yeast, Toaster, Bacteria, GrandBoule, Grinder, Crumbs, Levain, Crust, Gluten, Proof), Extension (frozen).

**Execution is behavior-preserving and staged** (8 waves, Workspace decomposed
last as highest fan-out), gated by twelve preservation guarantees (boot/mount,
one-AudioContext + RT-safety, live capture, save/load, undo/macro, DSO flow,
warp/stretch, pitch-edit, clip-selection persistence, routing edits, plugin
lifecycle, non-blocking dialogs). Each wave ends green on `deps:validate` +
`typecheck` + `typecheck:test` + touched tests, with the app bootable/playable
between waves. The wave sequence and per-move preservation checks are the change
plan's authority.

## Consequences

- Net **+20 modules**; cohesion rises and the worst coupling edges (Workspace's
  31-of-33 fan-out, Arrangement↔Workspace, the AudioEngine satellite spread) are
  cut or made one-way.
- The Arrangement↔Workspace cycle is broken structurally by moving clip selection
  into Arrangement's own store — a prerequisite, done in an early wave.
- New risks accepted and mitigated in the change plan: WorkspaceShell high
  distinct-module fan-out (mitigate: contract-barrel-only, enforced by
  deps:validate); TimelineEditor as a deliberate wide reader (must never gain an
  owned aggregate); DSO-generate severance depends on generation being an
  AppAction/event (else an anti-corruption query contract); AudioEngineCore stays
  large with AudioCapture/MeteringCompute as pre-identified internal seams.
- Relationship to prior ADRs: extends [0006](0006-contract-folder-barrels-no-module-root-index.md)
  (contract-folder barrels remain the only cross-module surface for every new
  module); [0003](0003-engine-owned-plugin-runtime-owner.md) /
  [0004](0004-plugin-hosting-security-policy.md) now attach to PluginHost. Supersedes
  no ADR.

## Deferred (not decided here)

- **Extension** keep-frozen vs delete — a product/security call; stays in the
  open-decision docket (kept whole and frozen by this ADR; unwired regardless).
- **Top-level count packaging** — the thin generics (Onboarding, Preferences,
  CvGate, DawInterchange) are bounded contexts; whether they live as top-level
  modules or sub-packages inside their hosts is a reversible packaging choice, not
  a boundary one. This ADR fixes the boundaries, not the packaging.
