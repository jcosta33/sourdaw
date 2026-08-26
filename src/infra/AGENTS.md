# src/infra — Agent Guidelines

Cross-cutting technical infrastructure: singleton AudioContext management, AudioWorklet module loaders, DI container, typed event bus, structured logging, dialog service, and store utilities.

## Domain Ownership

- Owns app-wide WebAudio `AudioContext` lifecycle and audio clock references (`audioContext/`).
- Owns WASM and AudioWorklet processor module loading pipelines (`audioWorklet/`).
- Owns core Dependency Injection container (`di/diContainer.ts`).
- Owns base typed event bus primitive (`events/EventBus.ts`).
- Owns structured logging, error classification, and telemetry formatting (`logger/`, `errors/`).
- Owns desktop dialog dispatch abstractions (`dialogService/`).

## Architectural Invariants (Hard)

- **Strict Layer Isolation (deps error)**: `src/infra/` MUST NEVER import from `src/modules/*` or `src/app/`. Infra provides domain-agnostic technical primitives only.
- **AudioContext Singleton**: The browser WebAudio graph MUST share the single `AudioContext` provided by `src/infra/audioContext/`—never instantiate ad-hoc `new AudioContext()` in modules or components.
- **Pure Infrastructure**: Code here contains no DAW business logic, track structures, or CRDT document schemas.

## Verification

```bash
pnpm deps:validate
pnpm test:run src/infra/
```
