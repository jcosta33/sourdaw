# AI-Native DAW — Architecture & Technical Research

## Role of this document

This is the **technical architecture and AI system reference** for the project.

It covers:
- Product vision and principles
- High-level system architecture
- Technology stack decisions with rationale
- Plugin system architecture
- Local AI system design (runtime, models, bundling, performance)

For the UI/UX product specification (layout, modes, tools, workflows), see **`.agents/tasks/spec.md`**.

For the implementation plan, phase sequence, and setup instructions, see **`.agents/tasks/task.md`**.

---

# 1. Product Overview

## Vision

Create a **modern DAW that combines the power of professional systems with the usability of modern creative software.**

Key properties:

- fully offline capable
- fully local AI models
- prompt-driven workflow
- voice control
- manual editing parity with professional DAWs
- modern UI architecture
- cross-platform

Platforms:

- macOS
- Windows
- Linux

Delivered as:

- Web application (primary)
- Native desktop wrapper (Tauri v2)

---

# 2. Reference DAWs (Feature Parity Targets)

The product must approach feature parity with:

- Ableton Live
- Logic Pro
- Pro Tools
- Cubase
- FL Studio
- Bitwig Studio
- Reaper

These are the benchmark. The app should feel like a real production tool, not a demo.

---

# 3. Core Product Principles

1. **Immediate usability** — works without a manual
2. **Minimum UI complexity** — no clutter, no modal hell
3. **Maximum editing speed** — every action is fast
4. **Zero modal confusion** — no floating window sprawl
5. **Everything discoverable** — via prompt, palette, right-click, or shortcut
6. **AI augmenting workflow** — AI is an assistant, not a gatekeeper

---

# 4. Interaction Model

Three simultaneous interaction methods, all routing to the same command system:

| Method          | Purpose                  |
| --------------- | ------------------------ |
| Manual editing  | primary workflow         |
| Prompt commands | natural language control |
| Voice commands  | hands-free editing       |

All interactions produce **typed app actions** that the command engine validates and executes. The AI does not get a special path — it uses the same command system as manual editing.

---

# 5. High-Level Architecture

```
Frontend (Web UI / React)
         ↓
    Command Engine          ← all actions — manual, prompt, voice — go through here
         ↓
    Audio Engine            ← Web Audio API, AudioWorklets, owns all real-time state
         ↓
    Native System Layer     ← Tauri v2: file system, plugin hosting, sidecar invocation
         ↓
    Local AI Model Layer    ← llama.cpp / whisper.cpp sidecars + browser ONNX runtime
```

Each layer is independently testable. The AI layer never bypasses the Command Engine.

### Application internals

```
Application
  ├ UI Layer                ← React 19 + TanStack Router + Shadcn UI
  ├ Command System          ← typed AppAction union, executeAppAction dispatcher
  ├ AI Runtime Layer        ← prompt parsing, voice ASR, action generation
  └ Audio Engine            ← AudioContext graph, worklets, transport, offline render
```

---

# 6. Technology Stack

## Frontend

| Concern | Technology | Notes |
| --- | --- | --- |
| UI framework | React 19 + React Compiler | no manual useMemo/useCallback |
| Type system | TypeScript strict + tsgo | `@typescript/native-preview` |
| Routing | TanStack Router | file-based, typed search params |
| Async state | TanStack Query | useSuspenseQuery, useMutation |
| UI state | `Store<T>` + `useSyncExternalStore` | project-native, no third-party |
| Styling | Tailwind v4 + Shadcn UI | CSS-first, dark mode default |
| Forms | React Hook Form + Zod | `@tanstack/zod-adapter` for search params |
| Build | Vite + `@tailwindcss/vite` + `@tanstack/router-plugin` | |

No third-party state library (no Zustand, Jotai, Redux, Recoil). The project has `Store<T>` and `ReadonlyStore<T>` in `src/helpers/Store/`.

## Rendering

Dense editor surfaces (timeline, piano roll, waveforms, automation, meters) must not be rendered as DOM trees. Use:

- **WebGPU** — primary GPU-accelerated renderer
- **Canvas 2D / OffscreenCanvas** — fallback where WebGPU is unavailable

React manages layout shells only. The renderer receives a render model and owns its own draw loop.

## Audio

- `AudioContext` — audio graph
- `AudioWorklet` — real-time DSP in isolated scope
- `AudioParam` — automatable parameters
- `OfflineAudioContext` — offline/bounce render

AudioWorklet processor files are plain JavaScript in `public/audio/worklets/`. They cannot be TypeScript-compiled by Vite.

## Native Wrapper

**Tauri v2** (required — not optional, not Electron).

Reasons:
- filesystem access for project files and plugin scanning
- native plugin host process
- lower audio latency than browser-only
- native sidecar support for llama.cpp / whisper.cpp binaries
- smaller bundle than Electron
- Rust backend: safe, typed command layer

Key Tauri v2 API notes:
- `#[tauri::command]` functions receive `app: tauri::AppHandle` as a parameter — not `tauri::AppHandle::current()`
- Use `.output().await` to run sidecars, not `.execute()`
- Use `tauri_plugin_shell::ShellExt` for sidecar invocation

---

# 7. Plugin Architecture

Target plugin formats:

- VST3
- CLAP
- AU (macOS only)

Implementation path: **native plugin host** running as a Tauri sidecar or child process.

Plugin UI options (in order of preference):
1. Parameter bridge UI — web UI mirroring plugin parameters (preferred long-term)
2. Native window embedding — embed plugin's own UI window

The web app communicates with the plugin host over a typed IPC bridge. Plugin parameters appear as automatable device slots in the track rack.

---

# 8. Local AI System

## Design requirement

All AI functionality must work **without any external setup**.

The system must never require:
- Python
- CLI tools
- external model downloads
- manual runtime installation
- user configuration

AI is ready as soon as the app opens.

## Runtime architecture

Two complementary runtimes:

### Browser-local runtime (web + desktop)

Library: `@huggingface/transformers` + `onnxruntime-web`

Used for:
- intent classification and command scoring
- lightweight text understanding
- browser-only fallback ASR (Whisper tiny/base)
- embedding generation

Models are downloaded on first use and cached in browser persistent storage (IndexedDB). After first load, fully offline.

Device priority: WebGPU → WASM fallback.

### Native sidecar runtime (desktop only)

Sidecars: `llama.cpp`, `whisper.cpp`

Used for:
- prompt-to-action generation (full LLM reasoning)
- structured command output with grammar constraints
- high-quality local ASR
- music generation (future)

Sidecars are bundled inside the Tauri app bundle. No download required on desktop.

## Model bundling

### Web application

1. User opens the app
2. App checks IndexedDB for cached models
3. Missing models download automatically in the background
4. Models initialize; AI features become available progressively
5. Subsequent loads are fully offline

### Desktop application

Models ship inside the app bundle:

```
app/
  sidecars/
    llama          ← llama.cpp binary
    whisper        ← whisper.cpp binary
  models/
    command-intent.gguf
    whisper-base.en.bin
```

No download or configuration required.

## Model types

### Command interpretation model

Purpose: convert natural language into structured DAW actions.

Example:

```
"add shaker from bar 8 to 16"
→ [{ type: "addTrack", payload: { name: "Shaker", kind: "midi" } },
   { type: "createClip", payload: { trackId: "...", startBar: 8, endBar: 16 } }]
```

Priorities: fast inference, low memory, high accuracy on DAW-domain commands.

### Music generation models

- drum patterns
- MIDI fills and chord progressions
- melody generation

Output: MIDI data, not raw audio.

### Audio analysis models

- mix analysis and suggestions
- EQ analysis
- transient and rhythm detection

Input: audio buffer. Output: structured analysis result.

## Memory constraints

### Native sidecar models

| Model | Budget |
| --- | --- |
| Command/reasoning LLM | 1–2 GB (quantized GGUF, e.g. Qwen2.5-1.5B-Instruct) |
| Music generation | < 1 GB each |
| Audio analysis | < 500 MB |

### Browser-local models

| Model | Budget |
| --- | --- |
| Intent classification | < 100 MB (quantized ONNX, q4/q8) |
| ASR fallback | Whisper tiny (~40 MB) or base (~140 MB) |

All browser models must use quantization (q4 or q8) to minimize download size and WASM heap.

## AI performance targets

| Task | Target |
| --- | --- |
| Command interpretation | < 300 ms |
| Music generation | < 2 s |
| Audio analysis | < 1 s |

These targets make the AI feel like a responsive assistant, not a blocking process.

## AI safety layer

All model output passes through a validation layer before execution:

- action type must be in the known registry
- payload shape and numeric ranges must be valid
- referenced IDs must exist
- destructive operations require explicit user confirmation

The AI never executes actions directly. Output → validation → `executeAppAction()`.

## AI startup sequence

At app launch:

1. Browser runtime initializes (ONNX + Transformers.js)
2. Models load (from cache or download)
3. AI services register with the command system
4. Prompt bar and voice input become active

On desktop, sidecar processes are started on demand (first prompt), not at launch, to keep startup fast.

---

# 9. Performance Requirements

## Rendering

| Operation | Target |
| --- | --- |
| Clip drag | < 10 ms |
| Zoom | < 16 ms |
| Scroll | < 16 ms |

Achieve by:
- GPU-accelerated timeline (WebGPU / Canvas)
- virtualized track list (only visible tracks rendered)
- tiled waveform rendering with incremental redraw
- React Compiler handling memoization automatically

## Audio

- AudioWorklet for all real-time DSP (never main thread)
- AudioParam for all automatable parameters
- Scheduling via `AudioContext.currentTime` (never `setTimeout`)
- OfflineAudioContext for bounce/export

## AI

See section 8 performance targets above.

---

# 10. Future Expansion

Architecture must allow for:

- collaboration and remote sessions
- advanced AI mixing assistants
- generative instruments and sound design
- deeper plugin integration (parameter AI control)

Design decisions now should not foreclose these paths.

---

# End of Document
