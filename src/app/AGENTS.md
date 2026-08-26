# src/app — Agent Guidelines

Application composition root: dependency registration, DI container initialization, global command handler aggregation, router configuration, and bootstrap lifecycle.

## Domain Ownership

- Owns top-level DAW bootstrap sequence (`bootstrap.ts`, `main.tsx`, `App.tsx`).
- Owns central dependency injection registry (`registerDependencies.ts`, `registerGlobalErrorHandlers.ts`).
- Owns global command handler map aggregation (`getProductionCommandHandlerMaps.ts`, `captureCommandBatchPreflightState.ts`).
- Owns TanStack Router instance (`router.ts`) and global React Query client (`queryClient.ts`).
- Does not own domain business logic or direct audio synthesis (delegated to `src/modules/*`).

## Architecture & Boundary Invariants

- **Contract Barrel Imports Only**: `src/app/` is the composition root and may import from `src/modules/*` exclusively via the 4 public contract barrels (`useCases/`, `stores/`, `events/`, `presentations/views/`) and handler registrations. Deep imports into private module internals are strictly forbidden.
- **Universal Handler Registration**: All domain mutation handlers must register into the `Command` kernel during bootstrap, enabling single-entrypoint execution via `executeAppAction`.
- **No Circular Bindings**: Handlers and stores registered in bootstrap must avoid direct circular instantiation loops.

## Verification

```bash
pnpm deps:validate
pnpm test:run src/app/__tests__/
```
