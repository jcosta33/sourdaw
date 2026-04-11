# Spec: Contract-folder barrels

**Status:** In progress
**Audit:** `.agents/audits/module-boundary-strategy.md`
**Started:** 2026-04-10

---

## Target state

Each module exposes **four independently-importable contract surfaces**. No module-root `index.ts`.

```ts
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import type { TrackAddedEvent } from '#/modules/Arrangement/events';
import { ArrangementView } from '#/modules/Arrangement/presentations/views';
```

---

## Concrete decisions

| Open question | Decision |
|---|---|
| Root `index.ts` — delete or empty? | **Delete.** No aggregation shim, no empty file. |
| Transitional coexistence? | **Transitional depcruiser regex** (accept both old and new form) during migration. Docs and skill describe final state only (no transitional hedge). |
| `index.ts` vs `contract.ts`? | **`index.ts`** — TypeScript path resolution idiom. |
| Flip `no-circular` to `error` when? | **After all modules migrated.** Too many barrel-mediated cycles in flight during migration. |
| Arrangement first or pilot smaller module? | **Arrangement first.** Highest cycle-hit count; migration pattern is mechanical. |

---

## Contract-folder rules

1. Cross-module imports must target exactly one of:
   - `<module>/useCases/index.ts`
   - `<module>/events/index.ts`
   - `<module>/stores/index.ts`
   - `<module>/presentations/views/index.ts`
2. Each `<contract>/index.ts` may only re-export from files within its own folder.
3. No module-root `index.ts` — the root barrel pattern is permanently retired.
4. Same module: never import from `#/modules/SameMod/<contract>`. Use relative paths.
5. No use-case types on `useCases/index.ts` (same rule as before, applies to the new barrel).
6. If a module has no events, no `events/index.ts` is required.
7. If a module has no cross-module views, no `presentations/views/index.ts` is required.

---

## Per-module acceptance criteria

A module is **migrated** when:

1. `useCases/index.ts`, `stores/index.ts`, `events/index.ts`, `presentations/views/index.ts` exist (whichever apply).
2. Each barrel re-exports only from files in its own folder.
3. `grep -r "from '#/modules/<Module>'" src/ | grep -v "src/modules/<Module>/"` returns zero results (no root-barrel imports remain).
4. Root `<module>/index.ts` is deleted.
5. `pnpm typecheck` and `pnpm deps:validate` show no regressions from baseline.

---

## Migration order

1. **Arrangement** (1042 cycle hits — proof-of-pattern, highest leverage)
2. **AudioEngine, Transport, Command** (tier 1 hubs)
3. **Automation, Levain, Plugin, Workspace, MIDI, Project** (tier 2)
4. **Remaining modules** in any order
5. **Cleanup** — flip `no-circular` to `error`, retire `{ lazy: true }` getter workarounds

---

## Post-migration depcruiser regex

```
// cross-module-index-only — pathNot (final form, no root barrel):
'^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|events|stores|presentations/views)/index(?:\\.ts)?$'

// application-to-modules-public-surface-only — same final form
```

---

## Symbol classification for Arrangement

| Symbol | Source | Contract folder |
|---|---|---|
| `trackStore`, `defaultTrackState` | `stores/trackStore` | `stores` |
| `chordTrackStore` | `stores/chordTrackStore` | `stores` |
| `markerStore` | `stores/markerStore` | `stores` |
| `takeLaneStore` | `stores/takeLaneStore` | `stores` |
| `scratchPadStore` | `stores/scratchPadStore` | `stores` |
| `timelineViewStore`, `zoomTimeline`, `scrollTimeline`, `setScrollX`, `setAutoScroll`, `toggleAutoScroll`, `setScrollY` | `stores/timelineViewStore` | `stores` |
| Store state types | `stores/*` | `stores` |
| `AdjustmentEffectType` | `stores/adjustmentLayer` | `stores` |
| All use case functions | `useCases/**` | `useCases` |
| `mixerSnapshotStore` | `useCases/mixerSnapshot/operations` | `useCases` |
| `VelocityCurve`, `VCAGroup`, `ResolvedClip`, `ScratchPadSection`, `GetFactoryPresetsOutput`, `SaveCurrentAsPresetInput`, `TimelineMarkerStoreState` | `useCases/**` | `useCases` |
| `ArrangementBar`, `BeatRulerBar`, `MarkerLane`, `MidiLearnButton`, `TimelineChromeSurface`, `TimelineMinimap`, `TimelineSurface`, `TrackListView` | `presentations/views/**` | `presentations/views` |
| `TrackAddedEvent`, `TrackRemovedEvent` | `events/**` | `events` |
