# Webdaw Web App - AI Agent Guidelines

This document provides guidance when working with the Webdaw web application codebase.

## Commands

See `package.json` scripts for available commands. Key ones: `pnpm dev`, `pnpm test`, `pnpm typecheck:beta`, `pnpm lint`.

## Documentation

The `docs/` folder contains high-level, human-readable overviews. Skills (see below) contain the authoritative, enforceable rules agents must follow.

- **[architecture.md](./docs/architecture.md)** - DDD module structure, four-tier state model, engine/store/repo patterns, project graph.
- **[conventions.md](./docs/conventions.md)** - TypeScript style rules, naming conventions, import style, and forbidden patterns.
- **[events.md](./docs/events.md)** - Cross-module `DomainEvent` + `EventBus` overview.
- **[forms.md](./docs/forms.md)** - React Hook Form + Zod patterns overview.
- **[state-management.md](./docs/state-management.md)** - `Store`, `ReadonlyStore`, TanStack Query, and derived state overview.
- **[testing.md](./docs/testing.md)** - Vitest + React Testing Library strategy overview.
- **[accessibility.md](./docs/accessibility.md)** - WCAG 2.x AA requirements and DAW-specific a11y patterns.

### Research & Planning Docs (`.agents/`)

Consult these before implementing features in their domain. They contain API verdicts, library benchmarks, UX research, and design specifications.

- **[gap-analysis.md](./.agents/gap/gap-analysis.md)** — Feature parity tracker. **Check this first** before implementing any DAW feature to confirm its status (DONE / PARTIAL / MISSING).
- **[ai-implementation.md](./.agents/ai-implementation.md)** — Three-tier AI inference architecture (Web/Rust/Cloud), library versions, ONNX models, mistral.rs + Qwen3-8B for tool calling, Tauri streaming patterns.
- **[ai-ux.md](./.agents/ai-ux.md)** — Producer survey data, AI feature priority ranking, UX trust patterns (transparency, control, reversibility).
- **[automation.md](./.agents/automation.md)** — Unified automation system design (track, clip, object tiers), interaction spec, rendering requirements, implementation plan.
- **[ui-ux.md](./.agents/ui-ux.md)** — DAW UI research: piano roll spec, visualization features, modulation halos, metering, and what makes each major DAW great.
- **[killer-features.md](./.agents/killer-features.md)** — Tier 1/2/3 product feature roadmap and competitive differentiation strategy.
- **[native-apis.md](./.agents/native-apis.md)** — Per-subsystem Web vs Rust verdict table (14 subsystems). Cross-reference with `tauri-platform` skill.
- **[web-apis.md](./.agents/web-apis.md)** — WebKit/WebView2/WebKitGTK compatibility tables for every relevant Web API.
- **[hosting-plugins.md](./.agents/hosting-plugins.md)** — CLAP/VST3 plugin GUI hosting deep-dive. Cross-reference with `plugin-hosting` skill.
- **[plugins.md](./.agents/plugins.md)** — WAM 2.0 built-in plugin suite architecture. Cross-reference with `faust-wam-plugins` skill.
- **[instruments.md](./.agents/instruments.md)** — Faust + SFZ instrument design, quality assessment vs Logic Pro. Cross-reference with `faust-wam-plugins` skill.
- **[voice-midi.md](./.agents/voice-midi.md)** — MIDI I/O via `midir` and voice dictation via `whisper-rs` implementation details.

## AI Agent Skills

Skills are the authoritative implementation references. **Always read the relevant SKILL.md before writing code in that domain.** Skills are non-overlapping — each covers a distinct layer or concern.

### Core Architecture & State

- **[daw-architecture](./.agents/skills/daw-architecture/SKILL.md)** — Read when creating or modifying **any module**, use case, repository, store, engine class, or shared primitive. Enforces DDD module boundaries (only `useCases/`, `events/`, `errors/`, `presentations/views/` are public contracts), four-tier state ownership, real-time audio constraints (no React state for 60fps), and forbidden anti-patterns (barrel re-exports, shared hooks, model leakage).

- **[event-communication](./.agents/skills/event-communication/SKILL.md)** — Read when **emitting or subscribing** to cross-module events. Covers defining `DomainEvent` subclasses, using `EventBus` (class-keyed, not string-keyed), subscribing from use cases vs. React hooks with `useEffectEvent` + cleanup, and cache invalidation in response to events.

- **[state-management](./.agents/skills/state-management/SKILL.md)** — Read when choosing **which state tool to use**: `Store<T>` for UI state, `ReadonlyStore` for externally-fetched config, TanStack Query for server/async state, `useSyncExternalStore` adapter for connecting stores to React. Also covers persisted stores (`LocalStorageStorage`) and audio engine state bridging.

### Frontend Technologies

- **[react19-compiler](./.agents/skills/react19-compiler/SKILL.md)** — Read when writing **any React component or hook**. Covers React 19 patterns: `ref` as a regular prop (no `forwardRef`), `use()` for context/promises, `useEffectEvent` for stable Effect callbacks, `useTransition` for non-urgent updates, and Suspense + error boundary pairing. The React Compiler handles memoization automatically — never add `useMemo`/`useCallback`/`React.memo`.

- **[tanstack-query](./.agents/skills/tanstack-query/SKILL.md)** — Read when writing **query hooks, mutations, cache invalidation, or prefetching**. Covers `useSuspenseQuery`, `.getKey()` pattern, mutation `onSuccess` cache updates, targeted invalidation, infinite queries, and route-level prefetch. Business logic stays in use cases, not query functions.

- **[tanstack-router](./.agents/skills/tanstack-router/SKILL.md)** — Read when **adding routes, loaders, guards, search params, or navigation**. Covers file-based route definitions, typed router context, `beforeLoad` guards, route loaders for data prep, search param validation, and preloading.

- **[tailwind-v4](./.agents/skills/tailwind-v4/SKILL.md)** — Read when **styling components, configuring the design system, or theming Shadcn UI**. Covers Tailwind v4 Vite plugin, `@theme` CSS-first config, dark-mode-first DAW UI tokens, Shadcn CSS variable overrides, and v3→v4 migration pitfalls.

- **[frontend-a11y](./.agents/skills/frontend-a11y/SKILL.md)** — Read when **building or reviewing UI components** (buttons, sliders, toggles, canvas surfaces). Covers WCAG 2.x AA compliance, semantic HTML, DAW-specific ARIA patterns (`aria-pressed` for mute/solo, `role="slider"` for faders, live regions for transport/AI status), and Shadcn/Radix component usage.

- **[form-engineering](./.agents/skills/form-engineering/SKILL.md)** — Read when **creating any input, form, or settings dialog**. Covers React Hook Form + Zod schema registration, `<Form />` wrapper, `onValidFieldChange` pattern, and accessible form structure with Shadcn components.

- **[testing-conventions](./.agents/skills/testing-conventions/SKILL.md)** — Read when **writing any test**. Covers `Prophecy` for dependency mocking, `injectDependencies` for use cases, `vi.mock(import(...))` for modules, dummy data factories in `_tests/`, DOM testing with role/label queries, and event emission assertions.

### Media & AI Engines

- **[web-audio-engine](./.agents/skills/web-audio-engine/SKILL.md)** — Read when working on the **browser audio graph**: `AudioContext` lifecycle, `AudioWorklet` processors, `AudioParam` automation, track/bus routing, metering taps, offline rendering, transport scheduling, or clip playback. The engine owns timing; the UI only issues commands and observes state.

- **[webgpu-rendering-surfaces](./.agents/skills/webgpu-rendering-surfaces/SKILL.md)** — Read when building **high-density editor surfaces**: timeline, piano roll, waveform/spectrogram views, metering surfaces. React owns layout; WebGPU/Canvas/OffscreenCanvas owns dense drawing. Covers GPU draw pipelines, worker-based rendering, hit-testing, and zoom/pan interactions.

- **[audio-ai-runtime](./.agents/skills/audio-ai-runtime/SKILL.md)** — Read when integrating **low-level AI inference**: ONNX Runtime Web, Transformers.js for browser-local inference, WASM DSP hot paths, whisper.cpp/llama.cpp Tauri sidecars, and the Tauri command/event bridge. This is the infrastructure layer for AI models and audio processing.

- **[llm-action-bridge](./.agents/skills/llm-action-bridge/SKILL.md)** — Read when connecting **LLM output to app behavior**: typed `AppAction` definitions, `executeAppAction` dispatch, `parsePromptToAction` structured output, voice command pipelines, and the copilot UI layer. Models must never mutate app state directly — they emit validated, reversible actions.

- **[plugin-hosting](./.agents/skills/plugin-hosting/SKILL.md)** — Read when implementing **CLAP or VST3 plugin hosting** in Rust/Tauri, managing plugin GUI windows, audio thread safety, or plugin sandboxing. Covers `clack-host` (git dep, only safe Rust CLAP wrapper), `vst3` 0.3.0 (MIT since 2025), Tauri `unstable` bare native windows for plugin GUIs (floating windows only — embedding in WebView is impossible), `rtrb`/`triple_buffer` for lock-free RT communication, and platform gotchas (macOS `disable-library-validation` entitlement, Windows async command requirement, Linux GTK conflicts and XWayland).

- **[faust-wam-plugins](./.agents/skills/faust-wam-plugins/SKILL.md)** — Read when **building built-in DAW plugins** using Faust DSP or WAM 2.0, authoring SFZ instruments for sfizz WASM, selecting free sample libraries for commercial bundling, or managing the WAM plugin hosting lifecycle in AudioWorklet. Covers `faust2wam` compilation pipeline, LGPL-with-exception commercial distribution rights, WAM SDK hosting pattern, sfizz WASM opcode support, and the license matrix for commercially-safe sample libraries (CC0/CC-BY only).

- **[tauri-platform](./.agents/skills/tauri-platform/SKILL.md)** — Read when **choosing between Web APIs and Rust** for any DAW subsystem, configuring WebKit/COOP/COEP headers, implementing MIDI I/O via `midir`, voice dictation via `whisper-rs`, file system access via Tauri plugins, or handling platform differences between WKWebView/WebView2/WebKitGTK. Contains the canonical "use Web API vs use Rust" decision table for all 17 DAW subsystems, WebKitGTK version targets (2.42+ minimum), COOP/COEP configuration, and binary-data IPC patterns.


## Tech Stack

React 19, TypeScript, Rspack, TanStack Query, TanStack Router, Tailwind CSS v4, Vitest.

## Key Conventions

- Use `type` over `interface`, `as const` over `enum`
- Direct type imports: `import { type MyType } from '...'`
- Absolute imports with `#/modules/...` aliases
- Named exports only, explicit return types
- Block conditionals required, no chained ternaries
- Tailwind CSS exclusively for styling
- Wrap suspense components with `SuspenseGuard`

## Module Boundaries

Cross-module imports only from contract folders. Run `pnpm deps:validate` to check violations.

## Self-Improvement

When learning something generally applicable, ask the user if this file should be updated.
