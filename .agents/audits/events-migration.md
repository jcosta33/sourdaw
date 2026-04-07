# Event Infrastructure Migration Audit

## Goal
The purpose of this audit is to track the migration from the legacy event infrastructure (`src/helpers/Event/*`) to the new functional, typed event infrastructure (`src/infra/events/*`).

"Good" looks like:
- Zero imports from `src/helpers/Event/*`.
- `EventBus` usages replaced with `createEventBus<TEventMap>()` from `src/infra/events/createEventBus`.
- Legacy `DomainEvent` class usages removed; event payloads defined as plain typed objects in module `EventMap`s.
- The global string-based `APP_EVENTS` constant removed; replaced by typed `emit()` and `on()` calls using the new `EventBus`.

## Current State
The legacy infrastructure in `src/helpers/Event` is still heavily used across the application. It relies on a class-based `EventBus`, a class-based `DomainEvent` wrapper, and an untyped global `APP_EVENTS` constant string map. The new typed infrastructure has been implemented in `src/infra/events/` but has not yet been adopted by the consumer modules.

## Findings
- **Classes vs Plain Objects:** Domain events (`TrackAddedEvent`, `TrackRemovedEvent`, `AudioDeviceLoadedEvent`) are still extending the old `DomainEvent` class instead of being plain typed objects defined in an `EventMap`.
- **Global Event Constants:** The `APP_EVENTS` constant is being used across multiple modules (Command, Workspace, helpers) to trigger untyped UI or application events.
- **Dependency Injection:** The old `EventBus` class is being registered in `app/registerDependencies.ts` and injected into modules.

## Priorities
1. **Migrate `DomainEvent` classes to plain types:** This establishes the `EventMap` payload shapes needed for the new `EventBus`.
2. **Replace `EventBus` in DI:** Swap the legacy `EventBus` class with `createEventBus()` in `app/registerDependencies.ts` and update consumer injections.
3. **Eliminate `APP_EVENTS`:** Refactor components and use cases to use typed event names and payloads via the new `EventBus` instead of the global `APP_EVENTS` constant.

## Issues

### 1. Legacy `EventBus` usages
**Needed:** Replace imports of `#/helpers/Event/EventBus` with the new `EventBus` type from `#/infra/events/types` and instantiate using `createEventBus<TEventMap>()` from `#/infra/events/createEventBus`. Update `emit`, `subscribe`/`on` call sites to match the new API (e.g., removing `subscribe()` or `off()` in favor of the `on()` return function).
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:13`
- `src/modules/Toaster/useCases/toasterSubscriber.ts:1`
- `src/app/registerDependencies.ts:4`

### 2. Legacy `DomainEvent` class usages
**Needed:** Remove `DomainEvent` inheritance. Define plain object payloads inside a module-specific `EventMap` type.
- `src/modules/AudioEngine/events/AudioDeviceLoadedEvent.ts:1`
- `src/modules/Arrangement/events/TrackRemovedEvent.ts:1`
- `src/modules/Arrangement/events/TrackAddedEvent.ts:1`

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
- **Phase 1 (Payloads):** For modules defining `DomainEvent` classes, create an `EventMap` type (e.g., `ArrangementEvents`) that maps the event string (e.g., `'track:added'`) to its payload type.
- **Phase 2 (Infrastructure):** In `app/registerDependencies.ts`, instantiate a bus via `createEventBus<GlobalEventMap>()` (or module-specific buses depending on the DI design) and register it in place of the old class.
- **Phase 3 (Call Sites):** Update all `eventBus.emit(new TrackAddedEvent(track))` calls to `eventBus.emit('track:added', { track })`.
- **Phase 4 (Cleanup):** Delete the entire `src/helpers/Event` directory once all usages are migrated.

## Resolved
- None yet.
