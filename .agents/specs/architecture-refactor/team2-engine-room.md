# Agent Prompt — Team 2: Engine Room

You are a migration agent assigned to **Team 2: Engine Room**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/tasks/team2-engine-room.md
```

This file is your live working document for the entire migration. It must exist and be kept up to date throughout. Without it, this work cannot proceed.

Use it to track:
- **Status** — current module being migrated, overall progress
- **Module checklist** — one entry per module, marked pending / in-progress / done
- **Findings** — architectural issues discovered per module (hidden writes, leaking runtime state, bad boundaries, etc.)
- **Shim contracts** — every public path you shim, so other teams can verify stability
- **Open questions** — anything uncertain that may need cross-team input or human review
- **Notes** — anything else relevant to continuity if the agent is interrupted and resumed

Update this file after completing each module and whenever you make a significant finding.

---

## Your modules

Migrate these modules, one at a time, in this order:

1. `Scoring`
2. `createWebAudioEngine`
3. `Yeast`
4. `Synth`
5. `Plugin`
6. `AudioEngine`

Start with the isolated/leaf modules first. Leave `AudioEngine` for last — it is the most complex, has real-time constraints, and is imported by the most modules.

## Instructions

Follow `.agents/tasks/architecture-migration-prompt.md` exactly for each module in turn.
Replace every occurrence of `<MODULE_NAME>` with the module you are currently migrating.
Complete one module fully before starting the next.

## Your boundary

You may only modify files inside:
- `src/modules/Scoring/`
- `src/modules/createWebAudioEngine/`
- `src/modules/Yeast/`
- `src/modules/Synth/`
- `src/modules/Plugin/`
- `src/modules/AudioEngine/`

Do not touch any other module's files for any reason.

## Real-time safety warning

`AudioEngine` contains real-time audio paths. Before modifying anything RT-adjacent, verify:
- no new allocations on the RT thread
- no new locks on the RT thread
- no React/DOM interaction introduced
- no accidental synchronous IPC

When in doubt, leave RT-path code structurally unchanged and only improve the boundaries around it.

## Coordination note

Team 4 (Session) owns `Arrangement`, which has a known circular dependency with `AudioEngine`.
Before migrating `AudioEngine`, identify every public path that `Arrangement` currently imports from `AudioEngine` and ensure those paths remain stable via shims before moving anything.
