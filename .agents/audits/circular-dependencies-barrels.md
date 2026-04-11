# Circular dependencies — barrel cycles

## Scope

Cross-module circular dependencies routed through `index.ts` barrels. These are the cycles surfaced by the `no-circular` rule added in `.agents/audits/circular-dependencies.md` (2026-04-11), which currently runs at `severity: warn` and reports ~630 violations.

This audit covers the **structural causes** of those barrel cycles and the **strategy to break them**, not the file-level cycles already cleared in the prior audit.

**In scope:**

- All cycles where at least one edge passes through `src/modules/<X>/index.ts`.
- Bidirectional dependencies between module barrels at the use-case / store / repository layer.
- The TDZ (temporal dead zone) runtime crashes these cycles cause when module evaluation order is unfavourable.

**Out of scope:**

- File-level cycles already cleared in `circular-dependencies.md` (Patterns A–E).
- The single intentional dynamic-import-mediated cycle in the macro chain.
- Unrelated boundary violations tracked in `architecture-violations.md`.

## Goal

Zero cycles in the `pnpm deps:validate` output, with `no-circular` enforced at `severity: error`. Each module's `index.ts` is one-way: nothing it transitively imports may reach back through that same `index.ts`. The fix is *architectural* — move misplaced state/logic, invert dependency direction, or push integration up to a composition root — not patching individual TDZ sites with lazy getters.

## Relevant code paths

- `.dependency-cruiser.cjs:54–73` — the new `no-circular` rule (currently `warn`).
- `.agents/audits/circular-dependencies.md` — file-level cycle audit, marked Resolved 2026-04-11; this audit is its declared follow-up.
- `docs/architecture/03-typescript-module.md` §3.3 — module boundary rules.
- `docs/architecture/03-typescript-module.md` §4.6 — `stores/` are part of the public contract; **state ownership is the deciding factor for which module a store belongs to**.
- `.agents/skills/architecture-violations/SKILL.md` §4.4 — semantic vs cosmetic compliance; the audit explicitly forbids "compatibility wrappers that become permanent shadow architecture", which describes the lazy-getter workaround.
- `src/infra/di/inject.ts` — `inject()` deps map is evaluated **immediately** at module top-level; the `{ lazy: true }` option requires getter properties to defer the binding read.
- `src/modules/Transport/useCases/ensureTrackStrips.ts:21–57` — existing precedent for the lazy-getter workaround. **This is the symptom, not the fix.**

## Current behavior

`npx depcruise src --output-type json` reports **1014 unique circular dependencies** (deduplicated by traversal-order-independent key) under the `src/` tree. The same data shows **440 cross-module barrel imports from use-case / handler / store / repository folders** — these are the load-time edges that create most of the cycles.

### Cycle distribution by length

```
length=3:    2  (file-level, intra-module — pre-existing dynamic-import workarounds)
length=5:   55  (canonical X<->Y pair through both barrels, one use case each side)
length=6:   38
length=7:   37
length=8:   53
length=9:   35
length=10:  30
...
length=15: 123  (peak — large fan-out chains)
length=16:  88
...
length=37:  20  (worst — multi-hop chains traversing 5+ modules)
```

### Modules ranked by cycle hit count

How many distinct cycles each module's `index.ts` participates in. **Higher = more architectural pressure on that barrel:**

| Hits | Module |
|---:|---|
| 1042 | Arrangement |
| 712 | AudioEngine |
| 579 | Transport |
| 378 | Command |
| 371 | Automation |
| 321 | Levain |
| 298 | Plugin |
| 197 | Workspace |
| 168 | MIDI |
| 135 | Project |
| 113 | AiGeneration |
| 88 | AiRuntime |
| 77 | AudioAnalysis |
| 64 | Fermenter |
| 43 | CrdtDocument |
| 33 | Collaboration |

The top four — Arrangement, AudioEngine, Transport, Command — account for the bulk. They are the de facto hub modules.

### Cross-module barrel imports from non-presentational layers

Top 15 directional pairs (`<from-module>` use case / handler / store / repository imports `#/modules/<to-module>`):

| Count | From → To |
|---:|---|
| 31 | Arrangement → AudioEngine |
| 20 | Arrangement → MIDI |
| 17 | Arrangement → Transport |
| 16 | AiGeneration → Arrangement |
| 14 | Workspace → Arrangement |
| 13 | Transport → AudioEngine |
| 13 | Project → Arrangement |
| 11 | MIDI → Arrangement |
| 11 | Project → AudioEngine |
| 11 | Arrangement → Automation |
| 10 | AiGeneration → MIDI |
| 9 | Workspace → MIDI |
| 8 | Project → Automation |
| 8 | Project → MIDI |
| 8 | Project → Transport |

Several of these pairs are **bidirectional**: Arrangement↔MIDI, Arrangement↔Transport, Arrangement↔Automation, Project↔Command, AiGeneration↔Arrangement. A bidirectional pair at the use-case layer is always a cycle (or the precursor to one). They are the highest-leverage targets.

### Module-pair cycle counts (length-5 only — the canonical pattern)

```
22  Arrangement <-> MIDI
14  Arrangement <-> Transport
13  Arrangement <-> Automation
 1  Arrangement <-> AudioAnalysis
 1  AiRuntime <-> AudioAnalysis
```

55 length-5 cycles, all but two of which involve **Arrangement** as one side.

### TDZ crashes already observed

Three runtime crashes were hit while landing the file-level cycle fixes — all are barrel cycles that existed long before this audit, but evaluation-order shifts from those edits made them reproducible:

1. `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:20`
   `Cannot access 'takeLaneStore' before initialization`
   — `projectStores` array literal at module top-level reads `takeLaneStore` while `Arrangement` barrel is mid-evaluation.

2. `src/modules/CrdtDocument/useCases/revertAction.ts:15`
   `Cannot access 'executeAppAction' before initialization`
   — `inject({ executeAppAction, … })` deps object literal at module top-level reads `executeAppAction` while `Command` barrel is mid-evaluation.

3. `src/modules/Project/useCases/projectPersistence/helpers.ts:17`
   `Cannot access 'undoStore' before initialization`
   — same shape as #2: `inject({ undoStore })` at module top-level while `Command` is mid-evaluation.

These are **three random samples** from the cycle population. There are almost certainly more sites that will crash under different load orders. The lazy-getter `{ lazy: true }` pattern (used in `Transport/useCases/ensureTrackStrips.ts:21–57`, `startPlayback.ts:18`, `toggleRecording.ts:60`) is the existing workaround — it defers the binding read to call time. **It is a workaround, not a fix:** it requires every cycle to be patched at every site that uses it, indefinitely, and it allows the underlying graph problem to keep growing.

## Findings

1. **1014 cycles is not 1014 problems.** The cycles are highly clustered. A small number of bidirectional pairs (Arrangement↔MIDI, Arrangement↔Transport, Arrangement↔Automation, Project↔Command) generate most of the volume because every cycle through one edge gets counted independently from each starting node. Breaking a single bidirectional pair will cascade: dozens or hundreds of cycles disappear at once.

2. **Arrangement is the primary architectural pressure point.** It participates in 1042 cycles — more than the next two modules combined — and is one side of every length-5 cycle except two. It is not just a hub; it has become a *catch-all* whose `index.ts` re-exports symbols that should belong to other modules. Fixing the misplaced symbols (see Issue 1 below) will likely reduce the total cycle count by an order of magnitude.

3. **Three concrete examples of misplaced ownership** (each represents a category of fix):

   - **State in the wrong module.** `Arrangement.chordTrackStore` is read and mutated by `MIDI/useCases/chordTrack/addChordEvent.ts`. Chord track *data* is MIDI domain, not arrangement domain. The store lives in Arrangement only because it was placed there once and nothing pushed back. Moving `chordTrackStore` to `MIDI/stores/` would break the back-edge from `MIDI → Arrangement`.

   - **Pure logic in the wrong module.** `Arrangement.interpolateAutomationValue` is imported by `Automation/useCases/automation/getAutomationValueAtBeat.ts`. Automation interpolation is *automation logic* — it belongs in `Automation/services/`. The function lives in Arrangement for historical reasons; the dependency arrow is reversed.

   - **Composition logic in a domain module.** `Transport/useCases/ensureTrackStrips.ts` imports `trackStore` from Arrangement, calls into AudioEngine (`addDeviceToStrip`, `setTrackGain`, …), and calls into Routing (`ensureBusStrip`, `setSend`). It reads from one module, fans out into two others, and is itself called from `transportControls/startPlayback.ts`. This is **composition / orchestration logic**, not Transport domain logic. It belongs at a composition root (handler, bootstrap, or a dedicated `playbackPreflight` use case in a higher-level module that depends on all three downstream modules one-way).

4. **The `inject()` deps object literal evaluates eagerly at module top-level.** A line like `export const x = inject({ executeAppAction })(…)` evaluates `{ executeAppAction }` immediately at module load. If `executeAppAction` is in TDZ at that moment (because of a barrel cycle), the module crashes before any user code runs. This is why TDZ crashes appear at `inject(…)` call sites even though `inject()` is "lazy" — the deps object is constructed eagerly, the *resolution* of those deps is what's lazy. The `{ lazy: true }` option exists specifically for this case but requires the caller to wrap each dep in a getter property.

5. **The lazy-getter workaround is shadow architecture.** Every site that uses `{ lazy: true }` is documenting the existence of a cycle without fixing it. It is exactly the "compatibility wrapper that becomes permanent shadow architecture" pattern §4.2 of `architecture-violations` warns against. Every new use case that touches a cycle-affected symbol has to remember to use the workaround, or the next reload order shuffle produces a new crash. There is no static enforcement that would catch a missing getter; the bug appears at runtime in the browser.

6. **The cycle count is currently masked by `severity: warn`.** Landing the no-circular rule as `error` immediately would block CI for ~630 violations (the depcruise count, which is lower than the 1014 madge count because depcruise reports cycles per *edge violation* rather than per *unique cycle*). The rule was set to `warn` so this audit's predecessor could land. Bumping to `error` is the right gating mechanism for the cleanup tracked here.

7. **There are 6 file-level cycles still flagged at the file level** (after the prior audit's fixes):
   - 4 are the macro chain (`handlePlayMacro` ↔ `playback` ↔ `executeAppAction` ↔ `getMacroHandlers`), broken at runtime by the dynamic import in `playback.ts:21`. The depcruise rule already excludes dynamic-import-mediated cycles. Out of scope here.
   - 2 are `Transport/useCases/playheadScheduler.ts` ↔ `Transport/useCases/transportControls/stopPlayback.ts`, also broken at runtime by `import('./transportControls/stopPlayback')` in `playheadScheduler.ts:181`. Same situation. Could be properly broken via an event bus emission ("loop end reached") that `stopPlayback` listens for, but that is a separate refactor.

## Priorities

In order of leverage (cycles cleared per unit of work):

1. **Fix Arrangement's misplaced ownership** (Issue 1). Three concrete moves identified. Each move breaks an entire bidirectional pair. Estimated >300 cycles cleared by this one action.
2. **Audit the remaining bidirectional pairs** (Issue 2). After step 1, the next biggest pairs are likely Project↔Command and AiGeneration↔Arrangement. Same strategy — find the misplaced symbol, move it.
3. **Push composition logic out of domain modules** (Issue 3). `ensureTrackStrips` is the named example; there are likely others. They need a composition layer (handlers or a dedicated `Playback` / `Bootstrap` use case module).
4. **Replace the lazy-getter workaround sites** with the actual fix (Issue 4). Once the underlying cycles are gone, the `{ lazy: true }` getters can be unwrapped.
5. **Bump `no-circular` to `severity: error`** (Issue 5). The forcing function for everything above. Cannot land until cycles reach zero (or near-zero with explicit allowlist).

## Open issues

### Issue 1 — Arrangement's `index.ts` re-exports symbols that belong to other modules

**Problem.** Arrangement is the participant in nearly every length-5 cycle and accounts for 1042 cycle hits. The reason: its `index.ts` re-exports symbols that other modules genuinely need to import, but those symbols are *domain data and logic for other modules*. The receiving modules then import them through Arrangement's barrel, creating a back-edge whenever Arrangement also depends on them.

**Representative examples (3 of likely many).**

| Symbol | Currently in | Belongs in | Cycle it creates |
|---|---|---|---|
| `chordTrackStore`, related types | `Arrangement/stores/chordTrackStore.ts` | `MIDI/stores/` | Arrangement ↔ MIDI (22 length-5 cycles) |
| `interpolateAutomationValue` | `Arrangement/useCases/...` (or services) | `Automation/services/` | Arrangement ↔ Automation (13 length-5 cycles) |
| (suspected) `trackStore` cross-module reads via `ensureTrackStrips` | n/a — see Issue 3 | composition layer | Arrangement ↔ Transport (14 length-5 cycles) |

**Needed.** For each misplaced symbol:

1. Confirm the ownership question: is this data/logic about Arrangement, or about the consuming module? "Whose invariants does it enforce?" is the test. `chordTrackStore` enforces *MIDI chord-event invariants*; it is MIDI's, not Arrangement's.
2. Move the file (`stores/<X>.ts`, `services/<X>.ts`, etc.) to the destination module.
3. Update the destination module's `index.ts` to re-export the symbol if cross-module callers exist.
4. Remove the re-export from Arrangement's `index.ts`.
5. Update all in-Arrangement consumers of the symbol to import from `#/modules/<NewOwner>` (or, if Arrangement still needs the symbol, accept that Arrangement is now a downstream consumer of the new owner — which is the *correct* one-way direction).
6. Verify the cycle count drops in `pnpm deps:validate`.

A complete sweep of Arrangement's `index.ts` should produce a short list of "what doesn't belong here" entries. **Do not write that list as part of this audit** — it requires reading every Arrangement export's call sites and judging ownership case-by-case. A separate research-style exploration is the right preparation.

### Issue 2 — Bidirectional barrel pairs at the use-case / store / repository layer

**Problem.** A use case in module X importing `#/modules/Y` is fine — that's the public contract. But when a use case in Y *also* imports `#/modules/X`, the two modules are bidirectionally coupled. Every transitive consumer becomes part of a cycle. The current data shows at least 5 such pairs:

| Pair | A → B count | B → A count |
|---:|---:|---:|
| Arrangement ↔ AudioEngine | 31 | (low, but present) |
| Arrangement ↔ MIDI | 20 | 11 |
| Arrangement ↔ Transport | 17 | 7 |
| Arrangement ↔ Automation | 11 | 7 |
| AiGeneration ↔ Arrangement | 16 | (low) |
| Project ↔ Command | 6 | 6 |
| Workspace ↔ Arrangement | 14 | (Arrangement → Workspace: 8) |
| Arrangement ↔ AudioAnalysis | 6 | (present) |

(Counts are barrel imports from non-presentational folders only; some pairs are also cycled through presentation views, which adds more.)

**Representative files.**

- `src/modules/MIDI/useCases/chordTrack/addChordEvent.ts:1` — `import { chordTrackStore } from '#/modules/Arrangement'` (back-edge into Arrangement from MIDI)
- `src/modules/Automation/useCases/automation/getAutomationValueAtBeat.ts:3` — `import { interpolateAutomationValue } from '#/modules/Arrangement'`
- `src/modules/Transport/useCases/ensureTrackStrips.ts:9` — `import { trackStore } from '#/modules/Arrangement'`
- `src/modules/CrdtDocument/useCases/revertAction.ts:2` — `import { executeAppAction } from '#/modules/Command'` (back-edge into Command)
- `src/modules/Project/useCases/projectPersistence/helpers.ts:5` — `import { undoStore } from '#/modules/Command'` (back-edge into Command)

**Needed.** Each bidirectional pair is its own ownership question, but the resolution menu is small:

1. **Move the symbol to its real owner** (Issue 1's strategy). The most common fix and the highest leverage.
2. **Replace the static import with an event bus emission.** If feature A's use case needs to "tell" feature B that something happened, an event is the right shape — neither side needs to import the other. Requires that the listener be wired up at bootstrap.
3. **Push the integration up to a handler or composition use case.** If A and B both need to participate in some workflow, neither A nor B should own the workflow — a higher-layer caller (a `Command` handler, or a dedicated composition module) coordinates them. Both A and B then become one-way downstream from the coordinator.
4. **Use `inject()` from a composition root** to pass the dependency in at runtime, so the use case doesn't import the destination barrel statically. This is the right tool when there are 1–2 cross-module symbols and the call graph can be inverted.

### Issue 3 — Composition / orchestration logic placed inside domain modules

**Problem.** Some "use cases" inside domain modules are not domain operations — they are orchestration that reaches into multiple other modules. They are the wrong shape for a use case (per `03-typescript-module.md` §4.4: "use cases must not become generic dumping grounds for unrelated helper logic"). Whenever such an orchestration use case is imported by code that one of its targets also depends on, it creates a cycle.

**Representative file.** `src/modules/Transport/useCases/ensureTrackStrips.ts:1–60`

```ts
import { trackStore } from '#/modules/Arrangement';
import { addDeviceToStrip, ensureTrackStrip, setTrackGain, /* … */ } from '#/modules/AudioEngine';
import { ensureBusStrip, setBusGain, setSend } from '#/modules/Routing';
```

This file is in `Transport/useCases/`, but it:
- reads state from `Arrangement` (not Transport)
- mutates `AudioEngine` (not Transport)
- mutates `Routing` (not Transport)
- emits no transport-domain semantics

It is a "playback preflight" / "sync engine state to current arrangement state" composition. It exists in Transport because that's where `startPlayback` calls it from — but `startPlayback` could call it from anywhere as long as the result happens before audio begins.

**Needed.** Move composition logic out of domain modules. Options:

1. **Push into the calling handler.** `handleStartPlayback` (in `Transport/handlers/transport/`) could compose `ensureTrackStrips` inline before calling the domain `startPlayback` use case. Handlers are allowed to import multiple modules — that is exactly their job.
2. **Create a small composition module** (e.g. `Playback`) whose only role is to depend on Arrangement, AudioEngine, Routing, and Transport one-way. This module owns the orchestration. None of the four downstream modules import it. This is the cleanest answer when the same composition is needed from multiple call sites.
3. **Bootstrap-time wiring with `inject()`.** If the orchestration runs once at app start, it can be a top-level call in `bootstrap.ts` that resolves all the dependencies via `inject()`.

The same audit should be applied to other "use cases" that import from 3+ external modules — that's a strong signal of misplaced orchestration.

### Issue 4 — Lazy-getter `{ lazy: true }` workaround sites are shadow architecture

**Problem.** Three files currently use `inject({ get x() { return x; }, … }, { lazy: true })`:

- `src/modules/Transport/useCases/ensureTrackStrips.ts:21–57`
- `src/modules/Transport/useCases/transportControls/startPlayback.ts:18`
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts:60`

These were added precisely to dodge TDZ crashes from the cycles documented in this audit. They preserve the static import graph (the cycles are still there) and just defer the binding read to call time. They satisfy `architecture-violations` skill §4.4's definition of fake compliance: "preserves hidden bidirectional coupling through indirection."

**Needed.** After Issues 1–3 are addressed and the underlying cycles are broken, **unwrap each lazy-getter site back to a normal `inject()` call**. The `{ lazy: true }` option should become unused in the codebase. If a future site genuinely needs lazy resolution, it will be evidence of a new cycle that needs the same treatment as this audit prescribes — not a sanctioned long-term pattern.

Until those underlying cycles are fixed, **do not add new lazy-getter sites**. The user's repeated TDZ crashes today are a warning sign that the workaround does not scale: every new site is one more place a developer has to remember the special syntax, and it produces no compile-time error when forgotten.

### Issue 5 — `no-circular` rule is `severity: warn`, not `error`

**Problem.** The rule was added as `warn` because enabling it as `error` would have blocked CI for ~630 pre-existing violations. As long as it's `warn`, new cycles can land freely and are invisible to anyone not specifically looking at `pnpm deps:validate` output.

**Representative file.** `.dependency-cruiser.cjs:54–73`

**Needed.** After Issues 1–4 are resolved (or after a quantitatively meaningful drop in cycle count), bump the rule to `severity: error`. This is the gating mechanism that prevents the problem from coming back. Until the count is at zero, an interim option is to `error`-fail any *new* cycle by snapshotting the current count and erroring on regression — depcruise has no native support for this, but a small wrapper script around `pnpm deps:validate` could parse output, compare against a baseline, and exit non-zero on increase. This is itself work; the simpler answer is "fix the cycles, then bump severity."

### Issue 6 — Two file-level cycles in Transport are mediated only by dynamic import

**Problem.** `playheadScheduler.ts` ↔ `transportControls/stopPlayback.ts` cycle:

- `stopPlayback.ts:4` statically imports `stopPlayheadScheduler` from `playheadScheduler`
- `playheadScheduler.ts:181` does `import('./transportControls/stopPlayback').then(({ stopPlayback }) => stopPlayback())` (dynamic, breaks cycle at runtime)

The new `no-circular` depcruise rule already ignores this via `dependencyTypesNot: ['dynamic-import']`, so it does not contribute to the warning count. But it is structurally the same as the macro chain — a real bidirectional dependency papered over by dynamic import.

**Needed.** Optional cleanup: replace the dynamic import with an event emission. `playheadScheduler` emits `playback.loopEndReached` (or similar); `stopPlayback` (or a transport handler) subscribes. This is purely a style / clarity improvement; the runtime is fine today and the depcruise rule already accepts it. Lowest priority.

## Open questions

1. **Which Arrangement exports actually belong to other modules?** Issue 1 needs an inventory. It cannot be answered from the cycle graph alone — it requires reading each export's name + call sites and making an ownership judgement. The audit lists three confirmed examples (`chordTrackStore`, `interpolateAutomationValue`, plus the orchestration in Issue 3); the rest of the list is unknown.

2. **Should there be a top-level `Composition` / `Playback` module** for the orchestration logic that does not naturally belong to any domain? Or should that logic always live inside a handler? The choice affects where Issue 3's targets land.

3. **Is there value in the snapshot-based regression check** for Issue 5, or should the work focus exclusively on getting the count to zero so the rule can flip to `error`?

4. **AudioEngine has 712 cycle hits but is not in any length-5 cycle in the data.** Why? Hypothesis: AudioEngine is one-way downstream from most other modules (correct direction), but it participates in longer cycles via shared transitive deps. Worth confirming before targeting AudioEngine for cleanup — it may already be correctly positioned, and the count reflects fan-in, not fan-out problems.

## Risks

- **Continuing to land lazy-getter patches** is path-dependent: each one is local and easy, none of them fixes the graph, and the codebase ends up with an ever-growing population of `{ lazy: true }` sites that future contributors will copy without understanding the shadow they live under. Six months from now, every cross-module `inject` will be wrapped in getters by default and the architectural fix becomes harder, not easier.
- **Random TDZ crashes will continue to appear** as evaluation order shifts. Each one looks like a one-off and tempts a one-line fix. The user has hit three so far in one session. The population of latent crashes is ~1014 cycles wide; the visible-crash rate is determined by which files happen to be top-of-graph at boot.
- **Fixing Arrangement first carries the highest blast radius.** Moving `chordTrackStore` from Arrangement to MIDI touches Arrangement's `index.ts`, MIDI's `index.ts`, every consumer of `chordTrackStore` (including any tests), and any handler/repository that wires the store. The work is large but the return per move is the highest in the codebase. Sequencing this correctly (one symbol at a time, validate after each) is essential.
- **`pnpm deps:validate` is currently green at the error level** because `no-circular` is `warn`. Anyone reading "validate is green" today will assume the codebase is healthy. Until the rule is `error`, the audit's findings are invisible to ordinary CI — only to people reading the warning output specifically.

## Suggested approaches

### A. Inventory pass on Arrangement's `index.ts`

The single highest-leverage piece of preparation work. Walk every export in `src/modules/Arrangement/index.ts` and answer for each:

- What does it represent — Arrangement domain data, or some other domain's data living in Arrangement?
- Who imports it cross-module? Are those importers' modules participating in cycles back through Arrangement?
- If the symbol moved to its real owner, does Arrangement still need to import it? (If yes — that's fine, the dependency just becomes one-way the other direction.)

Output: a numbered list of symbols to move, in priority order by cycle count cleared per move. This list is the input to a refactor session.

This inventory should be done **before** the first move, so the moves are sequenced sensibly (move foundational types first, then dependent symbols).

### B. Move state to its real owner

For each "store in the wrong module" identified by the inventory:

1. Move the file (`stores/<X>.ts`) to the destination module.
2. Update the destination's `index.ts` to export it.
3. Remove from Arrangement's `index.ts`.
4. Update consumers (largely `import` path changes).
5. Run `pnpm deps:validate` and `pnpm typecheck`. The cycle count should drop.
6. Commit before moving the next symbol.

Each move is a small, verifiable, reversible refactor. Do not batch them.

### C. Move pure logic to its real owner

Same procedure as B, but for `services/`, `validators/`, `transformers/`, and `models/` files. Pure functions are easier to move than stores because they have no state and no subscribers.

### D. Push composition logic up

For each "orchestration use case" (`ensureTrackStrips` and similar):

1. Decide where it belongs: handler, dedicated composition module, or bootstrap call.
2. Move the file. Adjust imports.
3. Update the original calling sites to call the new location.
4. Validate.

### E. Replace bidirectional barrel pairs with events or `inject()`

For pairs that survive A–D — i.e. cases where neither side is "wrong", they genuinely need to communicate — switch to an event bus or pass the dependency via `inject()` from a higher composition root. `events/` is the canonical answer per `03-typescript-module.md` §4.3.

### F. Unwind the `{ lazy: true }` workarounds

After A–E land, the three known lazy-getter sites should be unwrappable. Convert them back to plain `inject({ … })`. If a site can't be converted, that means the underlying cycle is still present and step A–E missed it.

### G. Bump `no-circular` to `severity: error`

Final step. Once the warning count is at (or very near) zero, change `.dependency-cruiser.cjs` and verify CI stays green.

## Recommendation

Start with **Approach A — the Arrangement inventory pass**. It is research-style work, not a refactor, and it produces the input that makes everything else possible. The output is a concrete prioritized list of moves rather than vague "fix Arrangement" guidance.

After the inventory:

1. Execute the top 3–5 moves (Approach B and C). Each move should drop the cycle count visibly. Stop after each and re-validate.
2. Address `ensureTrackStrips` and any other orchestration use cases identified (Approach D).
3. Re-survey: with Arrangement cleaned up, the next biggest pair becomes the new target. Repeat A on the new top module.
4. After 2–3 full module cleanup passes, the count should be low enough to bump `no-circular` to `error` (Approach G).
5. Unwind the lazy-getter sites (Approach F) only after the underlying cycles they were patching are gone.

**Do not** continue the lazy-getter pattern in the meantime. If a TDZ crash blocks the user, the right response is to investigate the specific cycle, find which Approach-A move would clear it, and do that move. The cycle that caused the crash is probably already in the priority list; the crash just made it concrete.

A spec is required before any code changes (per `documentation-gatekeeper`): `.agents/specs/break-arrangement-cycles.md` (or similar) should record the specific moves chosen from the inventory, in order, with acceptance criteria per move (cycle count delta, typecheck clean, tests passing).

## Resolved

_Empty. This audit precedes implementation; updates will be appended as moves land._
