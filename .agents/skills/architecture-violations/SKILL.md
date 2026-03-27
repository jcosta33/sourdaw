---
name: architecture-violations
description: Apply when fixing architecture violations, refactoring modules, or performing codebase audits. Contains mandatory rules for how to properly address violations without hacking around the architecture. Prevents barrel re-exports that bypass DDD boundaries, fake use cases, dumping unrelated logic into single files, and other anti-patterns.
---

# Architecture Violations Skill

Apply when fixing any architecture violation detected by `pnpm deps:validate`, during codebase audits, or when restructuring module internals.

## Core Principle

**Fix violations properly — never hack around the rules.**

If a violation exists, the correct fix is to set up the proper scaffolding (repositories, use cases, stores, etc.) so the code flows through the right architectural layers. **Never:**

- Change the validation rules to make violations pass
- Create barrel exports of non-contract entities to bypass import restrictions
- Move code into a "fake" use case file just to make imports work
- Rename files or folders to trick the validator

---

## Contract Folders

These (and only these) folders may be imported by other modules:

```
useCases/              → business operations + exported DTOs
events/                → DomainEvent subclasses
errors/                → AppError subclasses
stores/                → Store<T> instances (business-layer, cross-module)
presentations/views/   → composable UI entry points
```

**Everything else is private to its module:** `models/`, `repositories/`, `transformers/`, `helpers/`, `engine/`, `worklets/`, `presentations/hooks/`, `presentations/stores/`, `presentations/components/`.

> [!IMPORTANT]
> Note the distinction between `stores/` (business layer, **contract**) and `presentations/stores/` (UI layer, **private**). Business-layer stores hold project data, engine status, MIDI device lists, etc. Presentation-layer stores hold UI preferences (zoom, sidebar state) and are never imported cross-module.

---

## One Function Per File

**Each use case file exports exactly ONE function.** Each repository file exports exactly ONE function. No exceptions.

This is the single most important rule for keeping the codebase maintainable. When a module grows, the temptation is to dump everything into one mega-file. **Resist this.**

**❌ WRONG — mega use case file:**
```typescript
// useCases/trackActions.ts — 800 lines, 15 functions
export const addTrack = ...
export const removeTrack = ...
export const muteTrack = ...
export const soloTrack = ...
export const renameTrack = ...
export const duplicateTrack = ...
export const reorderTrack = ...
export const setTrackColor = ...
export const freezeTrack = ...
// ... 6 more
```

**✅ RIGHT — one function per file:**
```
useCases/
├── addTrack.ts
├── removeTrack.ts
├── muteTrack.ts
├── soloTrack.ts
├── renameTrack.ts
├── duplicateTrack.ts
├── reorderTrack.ts
├── setTrackColor.ts
└── freezeTrack.ts
```

### When There Are Too Many Files: Use Subfolders

When a module has 15+ use cases or repositories, group them in named subfolders. The subfolder name describes the logical concern.

```
useCases/
├── playback/
│   ├── startPlayback.ts
│   ├── stopPlayback.ts
│   ├── toggleLoop.ts
│   └── seekPlayhead.ts
├── tempo/
│   ├── setTempo.ts
│   ├── tapTempo.ts
│   └── setTimeSignature.ts
└── sync/
    ├── sendMidiClock.ts
    └── syncToExternal.ts
```

The same applies to repositories:

```
repositories/
├── engine/
│   ├── setEnginePlaybackRate.ts
│   ├── setEngineLoop.ts
│   └── seekEnginePosition.ts
├── storage/
│   ├── saveTransportConfig.ts
│   └── loadTransportConfig.ts
└── tauri/
    ├── invokeMidiClock.ts
    └── invokeExternalSync.ts
```

### When a Module Has Too Many Concerns: Split Into Smaller Modules

If a module grows beyond ~20 files across use cases + repositories, it likely covers too many concerns. Split it into smaller, more focused modules. This is always preferable to having a bloated module with dozens of files.

**❌ Module doing too much:**
```
AudioEngine/
├── useCases/        ← 30 files covering playback, routing, effects, metering, recording
├── repositories/    ← 15 files
└── ...
```

**✅ Split into focused modules:**
```
AudioEngine/         ← Core engine lifecycle, context, master output
Routing/             ← Track routing, bus routing, send/return
Metering/            ← VU meters, LUFS, spectrum analysis
Recording/           ← Arm, record, punch-in/out
```

---

## Repository vs Use Case: The I/O Boundary

This is the most critical distinction in the architecture. **Repositories touch the bare metal. Use cases only orchestrate.**

### What Goes in a Repository

Repositories are the adapter layer between your business logic and the outside world. A repository accesses:

- **DOM / Canvas / WebGL / WebGPU** — any browser rendering API
- **Web Audio API** — AudioContext, AudioNodes, AudioWorklet
- **localStorage / IndexedDB / sessionStorage** — client-side storage
- **fetch / WebSocket / SSE** — network I/O
- **Tauri invoke / listen** — native IPC
- **File system** — via Tauri fs plugin
- **Third-party libraries** — anything with side effects
- **MIDI ports** — via midir / Web MIDI API

A repository file is a thin wrapper. It translates domain concepts into API calls and API responses into domain types. It does NOT contain business logic, validation, or orchestration.

```typescript
// ✅ Repository — thin adapter around I/O
// repositories/saveProjectToStorage.ts
export const saveProjectToStorage = (data: ProjectState): void => {
    localStorage.setItem('sourdaw-project', JSON.stringify(data));
};
```

### What Goes in a Use Case

A use case is a business operation. It orchestrates repositories, validates inputs, updates stores, and emits events. **It never does I/O directly.**

```typescript
// ✅ Use case — orchestrates, validates, emits
// useCases/saveProject.ts
import { saveProjectToStorage } from '../repositories/saveProjectToStorage';
import { projectStore } from '../stores/projectStore';
import { eventBus } from '#/app/eventBus';
import { ProjectSavedEvent } from '../events/ProjectSavedEvent';

export const saveProject = (): void => {
    const state = projectStore.value;
    if (!state) {
        return;
    }
    saveProjectToStorage(state);
    eventBus.emit(new ProjectSavedEvent({ name: state.meta.name }));
};
```

### The Smell Test

If your use case file contains any of these, the I/O belongs in a repository:

- `localStorage.setItem` / `localStorage.getItem`
- `fetch(` / `new WebSocket(`
- `invoke(` / `listen(`
- `document.createElement` / `canvas.getContext`
- `new AudioContext` / `audioEngine.` direct method calls
- `navigator.` API calls
- Direct library API calls with side effects

If your repository file contains any of these, the logic belongs in a use case:

- `if (condition) throw new DomainError(...)`
- `eventBus.emit(new SomeEvent(...))`
- `store.set(...)` for business state
- Calling other repositories or use cases
- Multi-step orchestration logic

---

## No Barrel Exports of Non-Contract Entities

Cross-module imports MUST come from contract folders only.

**❌ WRONG — Barrel re-export bypass:**
```typescript
// modules/Arrangement/useCases/index.ts
export { trackStore } from '../stores/trackStore';  // stores/ is a contract, but
                                                     // this is in useCases/, misleading
```

**❌ WRONG — Re-exporting private internals through contract folders:**
```typescript
// modules/Arrangement/useCases/index.ts
export { useTrackControls } from '../presentations/hooks/useTrackControls'; // hooks are private!
```

---

## Proper Layer Separation

The DDD layers must be respected:

```
Presentation (views, hooks) → Use Cases → Repositories → External I/O
                             → Stores (read/write)
```

- **Presentations** consume use cases and stores (both same-module and cross-module)
- **Use cases** orchestrate repositories, update stores, emit events — NO direct I/O
- **Repositories** are thin adapters around external I/O — NO business logic
- **Business-layer `stores/`** are cross-module contracts — readable/writable from any module's use cases
- **Presentation-layer `presentations/stores/`** are module-private — only the owning module's presentations access them

---

## React 19 / TypeScript Conventions

When fixing violations, also enforce these conventions in any file you touch:

### No `useCallback`, `useMemo`, `React.memo`, or `forwardRef`

React Compiler handles memoization automatically. Remove all manual memoization.

```typescript
// ❌ const handler = useCallback((e) => { ... }, [dep]);
// ✅ const handler = (e) => { ... };
```

### Direct React Type Imports — No Aliases, No `React.` Prefix

Import types directly from React. Never alias them, never use `React.` dot notation.

```typescript
// ❌ import { type MouseEvent as ReactMouseEvent } from 'react';
// ❌ import * as React from 'react';
// ❌ (e: React.MouseEvent)
// ✅ import { type MouseEvent, type ReactElement } from 'react';
// ✅ (event: MouseEvent<HTMLDivElement>)
```

When the same file uses **both JSX event handlers and `addEventListener`**:
- Import the React event type directly (e.g., `type MouseEvent`)
- Use it for JSX handler params: `(event: MouseEvent<HTMLDivElement>)`
- For `addEventListener` callbacks, use the native type: `(event: globalThis.MouseEvent)`

### `type` Over `interface`

Always use `type` declarations, never `interface`.

```typescript
// ❌ interface TrackProps { ... }
// ✅ type TrackProps = { ... };
```

### No Single-Letter Variables

Use descriptive parameter names: `event` not `e`, `track` not `t`, `index` not `i` (loop counters excepted).

### No `import * as React`

Always use named imports:
```typescript
// ❌ import * as React from 'react';
// ✅ import { type ReactElement, useState, useRef } from 'react';
```

### Block Conditionals, No Chained Ternaries

```typescript
// ❌ condition && <Component />
// ✅ condition ? <Component /> : null
```

---

## Verification

After fixing any architecture violation:

1. Run `pnpm typecheck` — must pass clean
2. Run `pnpm deps:validate` — must pass clean
3. Run `pnpm lint` — no new warnings
4. Verify the app still loads: check `pnpm dev` output
