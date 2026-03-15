# task.md

## Mission

Build the product end-to-end from the provided specification, stack skills, and research documents.

This is **not** just a bootstrap task.  
This is the **main trigger document** for the agent.

The other documents shared alongside this one define the full set of rules and patterns you must follow. They live in the `.agents/` directory relative to the project root:

**Research and product spec:**
- `.agents/tasks/research.md` — product vision, UX principles, full architecture overview

**Skill files (read all of these before writing code):**
- `.agents/skills/react19-compiler/SKILL.md` — React 19 + Compiler rules
- `.agents/skills/tanstack-router/SKILL.md` — routing patterns
- `.agents/skills/tanstack-query/SKILL.md` — async state / query patterns
- `.agents/skills/state-management/SKILL.md` — Store<T>, useSyncExternalStore patterns
- `.agents/skills/event-communication/SKILL.md` — DomainEvent, EventBus patterns
- `.agents/skills/architecture.md/SKILL.md` — module structure, DI, domain errors
- `.agents/skills/form-engineering/SKILL.md` — form patterns
- `.agents/skills/frontend-a11y/SKILL.md` — accessibility patterns
- `.agents/skills/tailwind-v4/SKILL.md` — Tailwind v4 + Shadcn UI setup
- `.agents/skills/llm-action-bridge/SKILL.md` — AI action bridge patterns
- `.agents/skills/audio-ai-runtime/SKILL.md` — audio engine + AI runtime patterns
- `.agents/skills/web-audio-engine/SKILL.md` — Web Audio API patterns
- `.agents/skills/webgpu-rendering-surfaces/SKILL.md` — WebGPU / Canvas rendering patterns

This file tells the agent how to begin, how to sequence the work, and what success looks like.

---

## Primary Goal

Create a **working local-first AI-native DAW** with:

- browser app + desktop wrapper
- React 19 + Compiler
- TanStack Router
- TanStack Query
- Tailwind v4
- Shadcn UI
- strict TypeScript with **tsgo**
- Web Audio + AudioWorklet
- WebGPU/canvas rendering for performance-critical editor surfaces
- local AI only
- prompt-to-action bridge
- voice-command path
- no external AI APIs

The final result should be a **real working app**, not a mockup or a disconnected prototype.

---

## Operating Rules

1. Use **pnpm**.
2. Treat the other documents as authoritative guidance.
3. Use judgment. Do not be robotic about structure.
4. Prefer working code over ceremony.
5. Keep the system bootable as often as possible.
6. Make decisions that preserve:
   - local-first AI
   - browser + desktop compatibility
   - future extensibility
   - performance on critical surfaces
7. Do not overfit to one exact folder shape if a slightly different one is cleaner.
8. The **most important architectural principle** is:
   - the LLM must connect to **typed app actions**
   - those actions must trigger deterministic behavior in the app
   - the model must not directly mutate arbitrary app state

---

## Main Product Principles

Always optimize for:

- usefulness over gimmicks
- speed for creators
- clean modern UX
- local-first execution
- deterministic command handling
- manual control + AI augmentation
- excellent editing surfaces
- zero dependence on cloud AI APIs

The product must support:

- manual editing
- prompt-driven editing
- voice-triggered commands

These must coexist cleanly.

---

## What To Build

Build the full application in phases.

At minimum, the product should evolve toward:

### Core app

- routing
- app shell
- sidebar
- transport
- main editor area
- inspector
- command/prompt bar

### Data and state

- strict typed models
- views/hooks/use-cases integration
- query/state/router wiring

### AI

- prompt input
- prompt parsing
- structured actions
- action execution
- local runtime choice
- voice input path
- preview/confirmation where needed

### Audio

- audio engine
- transport
- graph
- buses
- worklets
- scheduling
- offline render path

### Rendering

- React for shell and normal UI
- WebGPU/canvas for dense editor surfaces
- performance-safe rendering model

### DAW surfaces

- timeline foundation
- track list
- clip rendering
- playhead
- zoom/pan
- inspector surfaces
- mixer foundation

### Desktop

- Tauri wrapper
- native command bridge
- local model sidecars
- local file/system integration

---

## First Priority

The first implementation goal is **not full feature parity immediately**.

The first goal is:

1. initialize the full stack correctly
2. create a working shell
3. wire the command/action architecture
4. wire the audio baseline
5. wire the rendering baseline
6. wire the AI baseline
7. produce a functioning app that can be iterated on safely

The app should become a **real executable system as early as possible**.

---

## Setup Requirements

Use **pnpm** for all package management.

Install the following with pnpm. Group them as shown.

### Core framework

```bash
pnpm add react react-dom
pnpm add -D @vitejs/plugin-react vite
```

### React Compiler

```bash
pnpm add -D babel-plugin-react-compiler
```

### Routing and query

```bash
pnpm add @tanstack/react-router @tanstack/react-query
pnpm add -D @tanstack/router-plugin
```

### Styling

```bash
pnpm add tailwindcss @tailwindcss/vite
```

Then run Shadcn UI init after Tailwind is configured:

```bash
pnpm dlx shadcn@latest init
```

### State persistence

```bash
pnpm add superjson
```

`superjson` is used internally by `LocalStorageStorage` from `src/helpers/Store/`. Required for any persisted store.

### Forms

```bash
pnpm add react-hook-form @hookform/resolvers zod
pnpm add @tanstack/zod-adapter
```

### UI and utility baseline

```bash
pnpm add clsx tailwind-merge class-variance-authority lucide-react
```

### Browser AI

```bash
pnpm add @huggingface/transformers onnxruntime-web
```

### Desktop / local AI bridge (install after Tauri is set up)

```bash
pnpm add @tauri-apps/api
pnpm add -D @tauri-apps/cli tauri-plugin-shell
```

### TypeScript native toolchain

```bash
pnpm add -D @typescript/native-preview typescript
```

The `@typescript/native-preview` package provides `tsgo`, the native TypeScript compiler. The `pnpm typecheck` script must run `tsgo --noEmit`, not `tsc --noEmit`. Do not install `typescript@7` — it does not exist yet; `@typescript/native-preview` is the correct package.

---

## Core Technical Direction

### React

Use React 19 with Compiler assumptions from day one.

Enable the React Compiler in `vite.config.ts`. This is the complete baseline config — include both plugins and the path alias:

```ts
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ routesDirectory: "./src/routes" }),
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "#": path.resolve(__dirname, "./src"),
    },
  },
});
```

Do **not** use `useMemo`, `useCallback`, or `React.memo`. The compiler handles memoization automatically.

### Routing

Use TanStack Router.

### Async/query state

Use TanStack Query.

### Client UI state

Use the project's `Store<T>` and `ReadonlyStore<T>` classes from `src/helpers/Store/`, connected to React via `useSyncExternalStore`.

There is **no third-party state management library** in this project. Do not install or use Zustand, Jotai, Redux, Recoil, or similar.

- `src/helpers/Store/Store.ts` — `Store<T>` class: `new Store(logger, { storage?, initialData? })`. API: `.value`, `.set(value)`, `.subscribe(callback)`, `.clear()`.
- `src/helpers/Store/ReadonlyStore.ts` — `ReadonlyStore<T>` class: created via `ReadonlyStore.create(logger, { storage, getDataFn })` (static async). API: `.value`, `.subscribe(callback)`, `.refresh()`. No `.set()`.
- `src/helpers/Store/Storage/MemoryStorage.ts` — in-memory storage (default).
- `src/helpers/Store/Storage/LocalStorageStorage.ts` — persisted storage. Requires a typed `LocalStorageKey` from `src/helpers/Store/Storage/LocalStorageKeys.ts`. **Add new DAW keys to the `LocalStorageKey` union in that file before using them.**

Stores are **module-level singletons** — never create a Store inside a React hook or component.

`Store.subscribe` passes the value to its callback. `useSyncExternalStore` wants a zero-argument notifier. Always adapt with an arrow wrapper:

```ts
useSyncExternalStore(
    (onChange) => store.subscribe(() => onChange()),
    () => store.value ?? defaultState,
    () => store.value ?? defaultState,
);
```

`Store.set()` replaces the **entire** value — always spread current state for partial updates:

```ts
store.set({ ...store.value!, key: newValue });
```

Audio engine state never lives in any React or UI store. It lives inside the engine and is observed via `useSyncExternalStore`.

### Styling

Use Tailwind v4 and Shadcn UI.

Tailwind v4 uses a CSS-first setup — no `tailwind.config.js`. The main CSS file only needs:

```css
@import "tailwindcss";
```

Initialize Shadcn UI after Tailwind is set up:

```bash
pnpm dlx shadcn@latest init
```

The design is **dark mode by default**. Set `class="dark"` on the root `<html>` element at startup.

### Type system

Use strict TypeScript and **tsgo** from day one.

The `pnpm typecheck` script must run `tsgo --noEmit` (provided by `@typescript/native-preview`).

Configure TypeScript path aliases so skills and modules can use `#/` as the `src/` root:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "#/*": ["./src/*"]
    }
  }
}
```

```ts
// vite.config.ts (add to resolve)
resolve: {
  alias: {
    "#": path.resolve(__dirname, "./src"),
  },
},
```

### Audio

Use:

- `AudioContext`
- `AudioWorklet`
- `AudioParam`
- `OfflineAudioContext`

### Editor rendering

Use React for the shell, but do **not** try to render high-density editor surfaces as ordinary DOM trees.

Use:

- WebGPU where appropriate
- Canvas/OffscreenCanvas fallback where appropriate

### Audio worklet files

AudioWorklet processors run in a separate scope — they cannot be TypeScript-compiled by Vite in the normal way.

Place worklet processor files as **plain JavaScript** in:

```
public/audio/worklets/gain-processor.js
public/audio/worklets/meter-processor.js
```

Reference them with the public path:

```ts
await context.audioWorklet.addModule("/audio/worklets/gain-processor.js");
```

Do not try to import them as TypeScript modules.

### AI runtime

Use local models only.

Preferred runtime split:

- browser-local inference for smaller tasks
- desktop-local sidecars for heavier tasks

### AI architecture

The model should produce **typed actions** that the app validates and executes.

The command/action bridge is the heart of the AI system.

---

## Project Folder Structure

Use this module structure consistently:

```
src/
  app/                          # App bootstrap, providers, router, query client
  routes/                       # TanStack Router file-based routes
  modules/
    AudioEngine/
      models/                   # TypeScript types for engine state
      useCases/                 # Engine actions (startTransport, setTempo, etc.)
      repositories/             # Web Audio graph builders (createWebAudioEngine)
      presentations/
        hooks/                  # useAudioEngine, useTransportState
        components/             # Audio-related React UI components
    Timeline/
      models/                   # TimelineRenderModel, ClipRenderModel
      useCases/                 # createTimelineRenderer, hitTestTimeline
      repositories/             # createWebGpuRenderer, createCanvasRenderer
      presentations/
        components/             # TimelineSurface
    Command/
      models/                   # AppAction union type
      useCases/                 # executeAppAction, action handlers
    AiRuntime/
      models/                   # PlannedAction, IntentResult
      useCases/                 # parsePromptToAction, runVoiceCommand
      repositories/             # createBrowserIntentRuntime, runLocalLlm
      presentations/
        hooks/                  # useAiCommand
        components/             # PromptBar
    Track/
      models/                   # Track type
      useCases/                 # addTrack, renameTrack, removeTrack
      repositories/             # in-memory or file-based project store
      presentations/
        hooks/                  # useTrack, useTracks
        views/                  # TrackView
        components/             # TrackHeader, TrackListItem
    Workspace/
      stores/                   # workspaceStore (Store<T> singleton — module-level, not in hooks)
      presentations/
        hooks/                  # useWorkspaceMode, useSidebarState
  helpers/
    Store/                      # Store<T>, ReadonlyStore<T>, MemoryStorage, LocalStorageStorage
    Event/                      # DomainEvent abstract class, EventBus, createEventBus (inject-based)
    DependencyInjector/         # Container singleton, inject() factory
    Errors/                     # AppError abstract base class
    Logger/                     # Logger class
    ErrorBoundary/
  components/
    ui/                         # Shadcn UI components (shadcn generated)
public/
  audio/
    worklets/                   # AudioWorklet processor .js files
  models/                       # ONNX model files for browser inference
src-tauri/
  src/
    commands/                   # llm.rs, speech.rs Tauri commands
  sidecars/                     # llama, whisper binaries
```

Cross-module imports must go through `useCases/`, `models/`, `events/`, or `errors/` contract folders. Never import from another module's `repositories/` or `presentations/`.

### Existing helpers — do not recreate

The `src/helpers/` directory already contains production-ready infrastructure. Use it:

| Helper | Usage |
| --- | --- |
| `Container` | `Container.getInstance().get(Token)` / `.register(Token, instance)` |
| `inject(deps, factory)` | DI for use cases; resolves from Container; **never inside hooks** |
| `Store<T>` | `new Store(logger, { storage?, initialData? })` — module-level singleton |
| `ReadonlyStore<T>` | `ReadonlyStore.create(logger, { storage, getDataFn })` — static async factory |
| `LocalStorageStorage` | Requires key from `LocalStorageKeys.ts` union; add new keys there first |
| `DomainEvent<TPayload>` | `abstract class` — extend for each event type |
| `EventBus` | `eventBus.on(EventClass, handler)` / `eventBus.emit(new EventClass(payload))` |
| `createEventBus` | inject-based factory — call once at bootstrap |
| `AppError` | `abstract class AppError extends Error` — extend for all domain errors; sets `this.name` automatically |
| `Logger` | Multi-writer logger; register in Container at bootstrap |

Do not invent factory functions like `createStore()` or `createEventBus()` as module-level exports unless they map exactly to the existing inject-based helpers above.

### App bootstrap sequence

The helpers have strict initialization order requirements. Bootstrap in this order in `src/app/main.tsx` (or equivalent):

1. **Register `Logger` in the Container first** — every other helper depends on it.
2. **Create the `EventBus` singleton** — call `createEventBus(logger, eventLog)` once; export it as `src/app/eventBus.ts`.
3. **Create module-level Store singletons** — they require `Logger` from the Container, so they must be defined after step 1.
4. **Register cross-module event handlers** — call registration functions (e.g., `registerTrackQueryHandlers()`) after stores and the query client are ready.
5. **Mount the React app** — everything above must be done before `ReactDOM.createRoot(...).render(...)`.

The event bus singleton must live in its own file so modules can import it without importing from the entry point:

```ts
// src/app/bootstrap.ts — run once before mounting React
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { ConsoleWriter } from '#/helpers/Logger/Writer/ConsoleWriter';
import { createEventBus } from '#/helpers/Event/createEventBus';
import { EventLog } from '#/helpers/Event/EventLog';

const logger = new Logger([new ConsoleWriter()]);
Container.getInstance().register(Logger, logger);

const eventLog = new EventLog();
export const eventBus = createEventBus(logger, eventLog);
```

```ts
// src/app/main.tsx
import './bootstrap'; // must be first — registers Logger in Container
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

Module-level Store singletons (e.g. `workspaceStore`) are created when their module files are first imported. Since they call `Container.getInstance().get(Logger)`, those files must only be imported after `bootstrap.ts` has run.

---

## Critical Architectural Rule

The AI does **not** directly manipulate arbitrary app state.

The intended flow is:

user input  
→ local model  
→ structured action(s)  
→ validation  
→ app execution  
→ resulting UI/audio state changes

This applies to:

- prompt commands
- voice commands
- future AI suggestions

If the AI needs to act, it must go through the app action layer.

---

## Agent Instructions

### Read everything first

Before writing any code:

1. Read this file in full
2. Read `.agents/tasks/research.md` — architecture, tech stack, AI system
3. Read `.agents/tasks/spec.md` — product vision, UX, features
4. Read all skill files listed at the top of this document

Do not start writing code until you understand the product, the architecture, and the conventions. Do not blindly scaffold — align to the materials.

### Then begin implementation

Start with the smallest working baseline that respects the stack and architecture.

### Keep the app running

After each major milestone, the app should still build and run.

### Make reasonable choices

If a detail is underspecified:

- use good engineering judgment
- prefer modern defaults
- preserve extensibility
- do not stop unnecessarily

### Avoid fake completeness

Do not create empty architecture theater.

Create real foundations that can support the product.

---

## Recommended Phase Plan

### Phase 1 — foundation

Set up the browser app first. Do **not** block on Tauri in this phase — get the web app running before adding the desktop wrapper.

- pnpm + Vite + React 19 scaffold
- TypeScript strict config + `#/` path alias + tsgo typecheck
- React Compiler enabled
- TanStack Router (file-based routes, basic shell route)
- TanStack Query (QueryClient provider)
- Tailwind v4 CSS-first setup
- Shadcn UI init
- Logger + Container bootstrap
- EventBus singleton
- Basic app shell: sidebar, main area, transport bar placeholders

Add Tauri after the browser app boots and renders cleanly. Tauri requires a Rust toolchain; do not let it block the web scaffold.

### Phase 2 — command system baseline

Create:

- typed app actions
- action execution layer
- prompt input UI
- local prompt parsing stub
- command preview path

### Phase 3 — audio baseline

Create:

- audio engine
- audio context lifecycle
- one worklet
- master gain
- transport state
- simple playback control

### Phase 4 — rendering baseline

Create:

- timeline surface component
- renderer abstraction
- WebGPU path
- fallback renderer path
- editor surface placeholder with real render loop

### Phase 5 — AI runtime baseline

Create:

- browser-local inference path
- Tauri local sidecar invocation path
- LLM/ASR stubs
- prompt-to-action integration
- voice-command integration shell

### Phase 6 — first real DAW behaviors

Implement initial usable actions such as:

- add track
- rename track
- set tempo
- toggle playback
- open mixer
- select track
- create clip placeholder

### Phase 7 — iterative expansion

Then expand the app toward:

- real arrangement editing
- mixer
- inspector logic
- waveform/timeline behaviors
- deeper AI actions
- voice UX
- local model improvements

---

## Minimum Standard for the First Real Deliverable

The first serious deliverable should include all of the following:

### App

- boots successfully
- runs in browser
- runs in Tauri desktop
- has real routed app shell

### UI

- sidebar
- toolbar / transport
- main editor surface
- inspector
- prompt bar

### Actions

- typed action model exists
- action execution path exists
- prompt path can trigger actions

### Audio

- audio context can initialize
- worklet can load
- transport can start/stop
- master gain can change

### Rendering

- dedicated editor surface exists
- not rendered as giant DOM tree
- real renderer abstraction exists
- WebGPU path is allowed
- fallback path exists

### AI

- browser-local AI dependency path exists
- Tauri local AI invoke path exists
- prompt parsing path exists
- actions are validated before execution

### Type safety

- strict TypeScript works
- `pnpm typecheck` uses tsgo

---

## Commands To Use

Use pnpm.

Typical commands should include:

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm tauri:dev
pnpm tauri:build
```

If scripts do not exist yet, create them. The required `package.json` scripts:

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsgo --noEmit",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

---

## Deliverable Expectations

At meaningful checkpoints, be able to report:

1. what is implemented
2. what runs right now
3. what the next milestone is
4. any blockers or tradeoffs

---

## What Not To Do

Do not:

- rely on cloud AI APIs
- build the AI layer as a generic chatbot first
- make React responsible for dense editor rendering
- put audio timing in React state
- let the model directly execute arbitrary code
- over-optimize structure before there is real behavior
- create fake completeness without working systems

---

## Final Instruction

Start the task now.

Bootstrap the project, install everything with **pnpm**, and begin implementing the full application in the phased order above.

The other documents define how the system should be designed.  
This file is the instruction to **begin and carry the implementation through**.

Prioritize a working, extensible, local-first AI-native DAW.
