# Event Infrastructure Migration Audit

## Goal
The purpose of this audit is to track the migration from the legacy event infrastructure (`src/helpers/Event/*`) to the new functional, typed event infrastructure (`src/infra/events/*`).

"Good" looks like:
- Zero imports from `src/helpers/Event/*`.
- `EventBus` usages replaced with `createEventBus<TEventMap>()` from `src/infra/events/createEventBus`.
- Legacy `DomainEvent` class usages removed; event payloads defined as plain typed objects in module `EventMap`s.
- The global string-based `APP_EVENTS` constant removed; replaced by typed `emit()` and `on()` calls using the new `EventBus`.

## Current State
The new typed event infrastructure (`src/infra/events/`) has been adopted for the core domain events. The global `EventBus` in `app/registerDependencies.ts` now uses `createEventBus<AppEvents>()`. Domain events (`TrackAddedEvent`, `TrackRemovedEvent`, `AudioDeviceLoadedEvent`) have been migrated from `DomainEvent` classes to plain typed payloads. All emit/subscribe call sites for these events use the new string-key API (`eventBus.emit('track.added', payload)` / `eventBus.on('track.added', handler)`). The remaining legacy piece is the `APP_EVENTS` constant used for DOM-level UI events.

## Findings
- ~~**Classes vs Plain Objects:** Domain events are now plain typed payloads.~~ **RESOLVED**
- **Global Event Constants:** The `APP_EVENTS` constant is still being used across multiple modules (Command, Workspace, helpers) to trigger untyped UI or application events.
- ~~**Dependency Injection:** The old `EventBus` class has been replaced with `createEventBus<AppEvents>()`.~~ **RESOLVED**

## Priorities
1. ~~**Migrate `DomainEvent` classes to plain types.**~~ **DONE** — `TrackAddedEvent`, `TrackRemovedEvent`, `AudioDeviceLoadedEvent` are now plain payload types.
2. ~~**Replace `EventBus` in DI.**~~ **DONE** — `app/registerDependencies.ts` now uses `createEventBus<AppEvents>()`.
3. **Eliminate `APP_EVENTS`:** Refactor components and use cases to use typed event names and payloads via the new `EventBus` instead of the global `APP_EVENTS` constant. This is a larger change touching ~7 files that use `document.dispatchEvent`/`addEventListener` with `sourdaw:*` strings.

## Issues

### ~~1. Legacy `EventBus` usages~~ — RESOLVED
All three files now use the new `createEventBus<AppEvents>()` bus imported from `#/app/registerDependencies` or `#/app/bootstrap`:
- ~~`src/modules/AudioEngine/engine/wasmDeviceRegistry.ts`~~ — imports `eventBus` from `#/app/bootstrap`
- ~~`src/modules/Toaster/useCases/toasterSubscriber.ts`~~ — imports `eventBus` from `#/app/registerDependencies`
- ~~`src/app/registerDependencies.ts`~~ — creates `eventBus` via `createEventBus<AppEvents>()`

### ~~2. Legacy `DomainEvent` class usages~~ — RESOLVED
All three event files are now plain typed payload exports:
- ~~`src/modules/AudioEngine/events/AudioDeviceLoadedEvent.ts`~~ → `AudioDeviceLoadedPayload`
- ~~`src/modules/Arrangement/events/TrackRemovedEvent.ts`~~ → `TrackRemovedPayload`
- ~~`src/modules/Arrangement/events/TrackAddedEvent.ts`~~ → `TrackAddedPayload`

### 3. Legacy `APP_EVENTS` string map usages
**Needed:** Remove `APP_EVENTS` imports. Define these events in the appropriate module's `EventMap` and emit/listen to them via the injected `EventBus`.
- `src/modules/Command/models/commands/projectCommands.ts:2`
- `src/modules/Command/models/commands/miscCommands.ts:2`
- `src/modules/Workspace/presentations/views/AppShell.tsx:10`
- `src/modules/Workspace/presentations/views/Sidebar/ColorTab.tsx:5`
- `src/modules/Workspace/presentations/views/Sidebar/StageTab.tsx:12`
- `src/modules/Workspace/presentations/views/Sidebar/InstrumentsTab.tsx:19`
- `src/modules/Workspace/presentations/hooks/useAppEventHandlers.ts:2`
- `src/helpers/Notification/notifyUser.ts:1`

### 4. Miscellaneous legacy helper usages
**Needed:** Remove `eventLogHelpers` and `EventLog` from legacy helpers once the new infrastructure is fully adopted. (Logging is deferred to v2 of the new infra, so test helpers `recordEvents` should be used for testing instead).
- `src/helpers/Event/eventLogHelpers.ts:1`

## Risks
- **Type Safety Gap:** As long as `APP_EVENTS` and the untyped legacy bus remain, developers might continue adding untyped events, risking runtime payload mismatch errors.
- **API Drift:** The legacy bus uses `subscribe` or separate `off` methods. Mixing both APIs in the codebase increases cognitive load and causes friction when moving between modules.

## Suggested Approaches
- ~~**Phase 1 (Payloads):**~~ **DONE** — Domain event classes converted to plain payload types.
- ~~**Phase 2 (Infrastructure):**~~ **DONE** — `app/registerDependencies.ts` uses `createEventBus<AppEvents>()`.
- ~~**Phase 3 (Call Sites):**~~ **DONE** — All `eventBus.emit(new Event(...))` calls converted to `void eventBus.emit('event.name', payload)`.
- **Phase 4 (Cleanup):** Delete the entire `src/helpers/Event` directory once `APP_EVENTS` (Issue 3) is migrated. The legacy `EventBus` class, `DomainEvent` class, and `eventLogHelpers` are no longer used by the migrated code, but may still have references from `APP_EVENTS` consumers.

## Resolved
- **Issue 1 — Legacy `EventBus` usages** (2026-04-07): All three files migrated to new `createEventBus<AppEvents>()` API.
- **Issue 2 — Legacy `DomainEvent` class usages** (2026-04-07): All three event files converted to plain typed payloads.
