# Module Ownership Map

This document assigns all modules in `src/modules/` to five agent teams for parallel migration.
Each team owns a coherent cluster of modules and works independently.
Because each agent refactors only its own modules' internals (preserving all external import paths via shims), merge conflicts after all five agents complete should be zero or near-zero.

---

## How to read this document

- **Owns** — the modules this team migrates, nothing else.
- **Depends on (external)** — other teams' modules that these modules import from. These paths must remain stable via shims; this agent must never touch those modules.
- **Merge risk** — estimated probability of a conflict with another team's branch.

---

## Team 1 — Conductor

**Theme:** Foundational platform infrastructure. These modules orchestrate execution flow, project persistence, and signal routing. They have no peers — almost everything else depends on them, so they must be stable by the time other teams' shims are resolved.

**Owns:**

- `Command` — undo/redo, action bus
- `Project` — project model persistence and lifecycle
- `Transport` — timing, playback, scheduling coordination
- `Routing` — audio routing graph
- `Toaster` — notification surface

**Depends on (external):**

- Command → AiGeneration _(Team 5)_, AiRuntime _(Team 5)_, Arrangement _(Team 4)_, AudioAnalysis _(Team 5)_, AudioEngine _(Team 2)_, Automation _(Team 4)_, Collaboration _(Team 4)_, CrdtDocument _(Team 4)_, MIDI _(Team 4)_, Plugin _(Team 2)_, Project _(own)_, Transport _(own)_, Workspace _(Team 5)_
- Project → Arrangement _(Team 4)_, AudioEngine _(Team 2)_, Automation _(Team 4)_, CrdtDocument _(Team 4)_, MIDI _(Team 4)_, Routing _(own)_, Toaster _(own)_, Transport _(own)_, Workspace _(Team 5)_
- Transport → Arrangement _(Team 4)_, AudioEngine _(Team 2)_, Automation _(Team 4)_, Collaboration _(Team 4)_, CrdtDocument _(Team 4)_, MIDI _(Team 4)_, Routing _(own)_, Synth _(Team 2)_, Yeast _(Team 2)_
- Routing → AudioEngine _(Team 2)_, CrdtDocument _(Team 4)_
- Toaster → Arrangement _(Team 4)_, AudioEngine _(Team 2)_, MIDI _(Team 4)_, Transport _(own)_

**Merge risk:** LOW. All five modules are self-contained directories. The agent only adds/moves files inside `Command/`, `Project/`, `Transport/`, `Routing/`, and `Toaster/`. No other team touches those directories.

---

## Team 2 — Engine Room

**Theme:** The audio processing core. AudioEngine is the hardest module in the codebase — real-time safety is absolute. Plugin hosting and synthesis sit just above it. Scoring and `createWebAudioEngine` are audio-tier concerns. Group together so the team can make consistent RT-boundary decisions.

**Owns:**

- `AudioEngine` — Web Audio graph, real-time scheduling engine
- `createWebAudioEngine` — factory/bootstrap for the audio engine
- `Plugin` — plugin instance lifecycle, editor windows
- `Synth` — synthesis engine
- `Yeast` — audio processing unit (imports AudioEngine + Transport)
- `Scoring` — isolated scoring module (zero external dependencies)

**Depends on (external):**

- AudioEngine → Arrangement _(Team 4)_, Bacteria _(Team 3)_, Command _(Team 1)_, Gluten _(Team 3)_, Grinder _(Team 3)_, Levain _(Team 3)_, MIDI _(Team 4)_, Plugin _(own)_, Proof _(Team 3)_, Scoring _(own)_, Transport _(Team 1)_, Yeast _(own)_
- Plugin → Arrangement _(Team 4)_, Command _(Team 1)_
- Synth → Arrangement _(Team 4)_, CrdtDocument _(Team 4)_, Plugin _(own)_
- Yeast → Transport _(Team 1)_

**Merge risk:** LOW. Files live in `AudioEngine/`, `createWebAudioEngine/`, `Plugin/`, `Synth/`, `Yeast/`, `Scoring/`. No overlap with other teams. Note: `AudioEngine` ↔ `Arrangement` is a known circular dependency — Team 2 must NOT move public `AudioEngine` paths that `Arrangement` (Team 4) imports; use shims.

---

## Team 3 — Instrument Workshop

**Theme:** All instrument and signal-processing modules follow an identical minimal pattern: they import only `Arrangement` and `AudioEngine`, own their own DSP or synthesis logic, and expose a clean plugin-style surface. This is the safest cluster for parallel migration — no cross-instrument dependencies exist.

**Owns:**

- `Bacteria`
- `Crust`
- `Fermenter`
- `Gluten`
- `Grinder`
- `Levain`
- `Proof`
- `ProofChamber`
- `SoundLibrary` — isolated, zero external dependencies

**Depends on (external):**

- All instruments → Arrangement _(Team 4)_, AudioEngine _(Team 2)_
- Levain → Arrangement _(Team 4)_ only
- SoundLibrary → none

**Merge risk:** NEAR-ZERO. Nine independent module directories with the simplest dependency profile in the codebase. No instrument imports another instrument. This team can do all nine modules safely in parallel within the team if desired.

---

## Team 4 — Session

**Theme:** The arrangement data layer and all modules that are inseparable from it. Arrangement is the project's main data hub — it imports many modules but is also imported by almost every other module. CrdtDocument, Collaboration, Automation, and MIDI are tightly coupled to this layer and collectively form the "session" bounded context.

**Owns:**

- `Arrangement` — track/clip/timeline data, the main project truth surface
- `MIDI` — MIDI event processing, deeply arrangement-coupled
- `Automation` — parameter automation (imports Arrangement, Command, CrdtDocument)
- `CrdtDocument` — collaborative document model and CRDT sync logic
- `Collaboration` — session sharing, presence, invite flow

**Depends on (external):**

- Arrangement → AiRuntime _(Team 5)_, AudioAnalysis _(Team 5)_, AudioEngine _(Team 2)_, Bacteria _(Team 3)_, Crust _(Team 3)_, Fermenter _(Team 3)_, Gluten _(Team 3)_, Grinder _(Team 3)_, Levain _(Team 3)_, Plugin _(Team 2)_, Routing _(Team 1)_, SampleLibrary _(Team 5)_, SoundLibrary _(Team 3)_, Command _(Team 1)_, Transport _(Team 1)_, Workspace _(Team 5)_
- MIDI → AudioEngine _(Team 2)_, Fermenter _(Team 3)_, Command _(Team 1)_, Transport _(Team 1)_
- CrdtDocument → Command _(Team 1)_, Project _(Team 1)_, Routing _(Team 1)_, Transport _(Team 1)_
- Collaboration → AudioEngine _(Team 2)_, Command _(Team 1)_, Transport _(Team 1)_, Workspace _(Team 5)_

**Merge risk:** LOW-MEDIUM. Arrangement is the highest-coupling module in the codebase, but the agent works only inside `Arrangement/`. The known `Arrangement` ↔ `AudioEngine` circular dependency means this team and Team 2 must coordinate on which public paths are kept stable via shims (agree up front, not mid-flight).

---

## Team 5 — Studio Shell

**Theme:** The user-facing intelligence and workspace layer. Workspace is the mega-orchestrator UI that imports nearly every module — its migration is primarily about cleaning up presentation/business separation inside the module itself. AI modules form a natural sub-cluster. VirtualKeyboard, SampleLibrary, Extension, and Knead are peripheral or isolated.

**Owns:**

- `Workspace` — top-level UI shell, panels, mixer, inspector, preferences
- `AiGeneration` — generative AI feature module
- `AiRuntime` — AI runtime session and action history
- `AudioAnalysis` — audio analysis pipeline
- `SampleLibrary` — sample browser (imports Workspace only)
- `VirtualKeyboard` — MIDI keyboard UI (imports AudioEngine, Workspace)
- `Extension` — isolated, zero external dependencies
- `Knead` — isolated, zero external dependencies

**Depends on (external):**

- Workspace → everything (all other teams)
- AiGeneration → AiRuntime _(own)_, Arrangement _(Team 4)_, AudioEngine _(Team 2)_, Command _(Team 1)_, MIDI _(Team 4)_, Transport _(Team 1)_
- AiRuntime → AiGeneration _(own)_, Arrangement _(Team 4)_, AudioAnalysis _(own)_, Command _(Team 1)_, CrdtDocument _(Team 4)_, MIDI _(Team 4)_, Transport _(Team 1)_
- AudioAnalysis → AiRuntime _(own)_, Arrangement _(Team 4)_, AudioEngine _(Team 2)_, Command _(Team 1)_, MIDI _(Team 4)_, Transport _(Team 1)_
- VirtualKeyboard → AudioEngine _(Team 2)_

**Merge risk:** LOW. Despite Workspace importing ~28 modules, all changes stay inside `Workspace/`. The shim rule ensures no other module's files are touched. The AI sub-cluster has a known `AiGeneration` ↔ `AiRuntime` circular dependency — keep them in the same team (done) so the same agent resolves it cleanly.

---

## Dependency graph between teams

```
         ┌──────────────────────────────────────────┐
         │            Team 5: Studio Shell           │
         │  Workspace, AiGeneration, AiRuntime,      │
         │  AudioAnalysis, SampleLibrary,            │
         │  VirtualKeyboard, Extension, Knead        │
         └───────────────┬──────────────────────────┘
                         │ imports from all teams
                         ▼
┌─────────────┐   ┌─────────────────┐   ┌──────────────────┐
│  Team 1:    │   │   Team 4:       │   │   Team 2:        │
│  Conductor  │◄──│   Session       │◄──│   Engine Room    │
│  Command,   │   │  Arrangement,   │   │  AudioEngine,    │
│  Project,   │   │  MIDI,          │   │  Plugin, Synth,  │
│  Transport, │   │  Automation,    │   │  Yeast, Scoring, │
│  Routing,   │   │  CrdtDocument,  │   │  createWebAudio  │
│  Toaster    │   │  Collaboration  │   │  Engine          │
└─────────────┘   └────────┬────────┘   └──────────────────┘
                           │ imports Arrangement + AudioEngine
                           ▼
               ┌───────────────────────┐
               │   Team 3:             │
               │  Instrument Workshop  │
               │  Bacteria, Crust,     │
               │  Fermenter, Gluten,   │
               │  Grinder, Levain,     │
               │  Proof, ProofChamber, │
               │  SoundLibrary        │
               └───────────────────────┘
```

---

## Cross-team coordination points

Only two situations require inter-team coordination before or during migration:

**1. Arrangement ↔ AudioEngine circular dependency (Team 4 and Team 2)**

- Both teams must agree up front on which public paths stay shim-stable.
- Neither team should move a path that the other currently imports without adding a shim first.
- Recommended: run Team 4 and Team 2 sequentially or have both teams declare their shim contracts before starting.

**2. Workspace omnibus imports (Team 5 and all teams)**

- Workspace imports from all four other teams.
- As long as Teams 1–4 preserve all existing public paths via shims, Team 5's Workspace migration is unblocked.
- Teams 1–4 must finish (or at minimum declare their shim surfaces) before Team 5 finalises Workspace.

---

## Module count summary

| Team | Name                | Modules | Risk       |
| ---- | ------------------- | ------- | ---------- |
| 1    | Conductor           | 5       | Low        |
| 2    | Engine Room         | 6       | Low        |
| 3    | Instrument Workshop | 9       | Near-zero  |
| 4    | Session             | 5       | Low-medium |
| 5    | Studio Shell        | 8       | Low        |
| —    | **Total**           | **33**  | —          |

---

## Suggested launch order

1. Launch **Team 1**, **Team 2**, and **Team 3** simultaneously.
2. Once Teams 1 and 2 have declared their shim contracts, launch **Team 4**.
3. Once Teams 1–4 have stable shim surfaces, launch **Team 5**.

If you are comfortable coordinating the Arrangement ↔ AudioEngine shim contracts manually upfront, all 5 teams can run simultaneously.
