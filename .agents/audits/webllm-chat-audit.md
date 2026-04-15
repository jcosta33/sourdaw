# Audit: WebLLM Commands & Chat Implementation

## Goal
The goal of this audit is to provide a comprehensive diagnosis of the AI Chat and Command implementation (`AiRuntime` module). This audit identifies specific architectural violations, performance bottlenecks, and structural weaknesses to serve as a roadmap for a major refactoring session.

## Current State & Diagnostics

### 1. Backend Orchestration & Constraints
- **Native (Tauri/Rust):** Uses the **`mistralrs`** stack via `src-tauri/src/commands/native_llm.rs` (not a separate `mistral.rs` file). `schema_constrained_generation` uses `Constraint::JsonSchema`, giving schema-shaped JSON for native DSO planning when the engine is up.
- **WebLLM (Browser/WebGPU):** Loads `@mlc-ai/web-llm` from the AiRuntime WebLLM layer. **Tool calling** (`repositories/webLlm/toolCalling.ts`): if the Hermes-style tool API fails or returns text, **`tryParseRawFunctionCalls`** regex salvage runs. **DSO edit path** (`executeDsoEdit` → `invokeLlm`): first attempt uses `response_format` + `EDIT_PLAN_JSON_SCHEMA`; on grammar failure the catch **throws** a user-facing error (no silent plain-text fallback for DSO — differs from tool-calling).
- **Cloud (Claude):** Used for chat / cloud tool paths; **DSO planning** explicitly avoids cloud fallback (`executeDsoEdit` comment: cloud not used for DSO — Qwen3 / configured backends only).

### 2. Architectural Integrity & Module Boundaries
- **Violation: No root module barrel:** There is **no** `src/modules/AiRuntime/index.ts` — cross-module code imports `#/modules/AiRuntime/useCases`, `#/modules/AiRuntime/stores`, or `#/modules/AiRuntime/presentations/views` instead of a single root barrel, which does not match the “one public surface per module” pattern in `AGENTS.md`.
- **Deep imports:** `rg` on `src/**/*.ts` and `src/**/*.tsx` shows **`#/modules/AiRuntime/useCases/<subpath>`** only under **`__tests__`** (mocks) and **`AiGeneration/.../llmMidiGeneration.spec.ts`**. **Production** modules use `#/modules/AiRuntime/useCases` (barrel) or `#/modules/AiRuntime/stores` — not deeper `useCases/...` paths. Sub-barrel violation remains **lack of root `AiRuntime/index.ts`**, not necessarily per-file deep imports in app code.
- **Violation: Store exposure:** `llmStatusStore` and `voiceStatusStore` are imported from `#/modules/AiRuntime/stores` by **`Workspace`** (`StatusBar`, `usePromptExecution`, `VoiceButton`) and similar — stores are part of the de facto public API.
- **Fast-path types vs Command:** **`RuntimeAction`** is defined in **`AiRuntime/models/RuntimeAction.ts`**, not in `Command`. The fast path parses into `RuntimeAction` and then calls **`executeAppAction`** from `Command` — so the coupling is *orchestration*, not “Command owns the types.”

### 3. Implementation Bottlenecks & Code Smells

#### A. Monolithic Orchestration (`sendChatMessage.ts` & `executeDsoEdit.ts`)
- **Problem:** `sendChatMessage` and `executeDsoEdit` are "God functions" handling backend branching, history management, serialization, and UI side-effects.
- **Diagnosis:** High cyclomatic complexity. Testing is extremely difficult.
- **Needed Refactoring:** Split into `ChatOrchestrator`, `ContextManager`, and `InferenceProvider` (Strategy pattern).

#### B. Brittle Tool-Call Parsing & Name Resolution (`toolCalling.ts`, `compileDso.ts`)
- **Problem:** For **tool calls**, when the model returns plain text instead of structured `tool_calls`, **`tryParseRawFunctionCalls`** runs — a regex parser that cannot handle nested JSON or complex strings. (**DSO** parsing uses `parseEditPlan` / JSON salvage in `executeDsoEdit.ts` — different path.)
- **Diagnosis:** The system relies on "happy path" model output. Furthermore, `resolveDsoNames` uses custom fuzzy matching. If it fails to resolve a track name, it auto-creates a track (`splice(i, 0, ...)`), leading to surprising side-effects.
- **Needed Refactoring:** Replace regex with a robust partial-JSON salvage parser. Move name resolution to an isolated, side-effect-free service.

#### C. Context serialization (`getProjectContext.ts`, `serializeLogicalState.ts`)
- **Problem (chat mode):** `sendChatMessage` builds `systemPrompt` with **`JSON.stringify(workspaceContext)`** on each send (`sendChatMessage.ts` ~193–195), embedding the **full** project summary for regular chat.
- **Refinement:** `getProjectContext()` **memoizes** when `trackStore` / `transportStore` / `workspaceStore` / `midiStore` **references** are unchanged (`getProjectContext.ts` ~52–82), avoiding redundant object rebuilds — but the **prompt still contains the full serialized graph** when sent.
- **DSO path:** `serializeLogicalState` / `buildProjectSummary` feed the edit planner — same large-state concern for edit sessions.
- **Needed:** Context slicing, relevance-ranked tracks/clips, or capped summaries for large sessions.

### 4. Deep Systemic Flaws

#### A. Severe UI Streaming Performance (`ChatPanel.tsx`)
- **Problem:** `ChatPanel` subscribes to the entire `chatStore` state via `useStore`. During streaming, `updateChatMessage` triggers a new store state for every single token emitted.
- **Diagnosis:** The *entire* Chat UI—including the React Markdown parsing of all previous messages—re-renders on every token. This will cause catastrophic CPU spikes and jitter on lower-end devices.
- **Needed Refactoring:** Move the streaming message UI into an isolated component (`StreamingMessage`) that subscribes only to its own changes, or decouple the token stream from the global state store entirely.

#### B. "Sledgehammer" Undo State (`executeDsoEdit.ts`)
- **Problem:** AI edits bypass the fine-grained transactional command history. Instead, the AI captures a full binary snapshot of all CRDT documents before and after execution: `bundleBefore = saveSnapshot()`.
- **Diagnosis:** This is incredibly inefficient for memory and undo history (storing massive CRDT bundles for simple edits like renaming a track).
- **Needed Refactoring:** Compile DSOs down into specific, undoable `AppAction`s rather than taking global state snapshots.

#### C. Accessibility (A11y) Gaps (`ChatPanel.tsx`)
- **Problem:** The `ReasoningBlock` component (which expands the LLM's chain of thought) is implemented as a `<button>` without proper ARIA attributes.
- **Diagnosis:** Missing `aria-expanded` and `aria-controls` makes this UI feature inaccessible to screen reader users.

#### D. MIDI Generation Gaps (`llmMidiGeneration.ts`)
- **Problem:** No musical validation or constraint checking.
- **Diagnosis:** The LLM can emit "garbage" MIDI. The current `parseMidiResponse` only checks for basic types (numbers).
- **Needed Refactoring:** Integrate a `MusicalValidator` that enforces DAW-specific constraints (e.g., polyphony limits, overlapping notes).

### 5. Overlapping backend orchestration (`inference.ts` vs `executeDsoEdit.ts`)
- **Problem:** `generateToolCalls` (`useCases/llmOrchestration/inference.ts`) walks **`getBackendChain()`** for tool-call generation. `executeDsoEdit` uses **`invokeLlm`** with different rules (native schema / native stream / WebLLM schema; **no cloud** for DSO).
- **Diagnosis:** Same backends reimplemented in multiple layers — drift risk when order or availability changes.
- **Needed:** Shared helpers for backend selection and status; keep DSO vs chat policy explicit.

---

## Refactoring Roadmap (Actionable Issues)

| ID | Issue | Diagnosis | Needed Refactoring | Priority |
| :--- | :--- | :--- | :--- | :--- |
| **ARCH-1** | Module surface | Sub-barrels + store imports from other modules. | Add **`AiRuntime/index.ts`** curating exports; narrow store access to facades or events. | **CRITICAL** |
| **CORE-1** | Monolithic Chat Logic | `sendChatMessage` & `executeDsoEdit` are too large. | Extract backend-specific logic. Decouple UI updates. | **High** |
| **CORE-2** | Inefficient Context | O(N) token usage for project context. | Implement `ContextOptimizer` to trim context based on relevance. | **High** |
| **CORE-3** | Overlapping backend logic | `inference.ts` chain vs `executeDsoEdit`’s `invokeLlm` duplicate concepts. | Shared backend helpers + explicit DSO vs chat policies (§5). | **High** |
| **PERF-1** | UI Re-render Storms | Entire `ChatPanel` re-renders per token. | Isolate streaming message rendering from global store. | **High** |
| **PERF-2** | Sledgehammer Undo | Full state snapshots on every AI edit. | Translate DSOs into granular `AppAction`s for undo history. | **High** |
| **FEAT-1** | Weak Tool/Name Parsing | Regex & custom fuzzy matching are brittle. | Implement robust salvage-parser and isolated NameResolution. | **Medium** |
| **A11Y-1** | Inaccessible Chat UI | Missing ARIA tags on interactive elements. | Add `aria-expanded` and `aria-controls` to `ReasoningBlock`. | **Medium** |

## Risks
- **Command Regression:** Changes to parsing/resolution might break existing prompts.
- **Heuristic Failure:** "Context Slicing" might omit critical information if heuristics are too aggressive.

## Resolved
- *(None — roadmap audit.)*

## Verification notes (2026-04-14)

| Claim | Result |
|--------|--------|
| Root `AiRuntime/index.ts` | **Absent** — only `stores/`, `useCases/`, `presentations/views/` barrels. |
| `RuntimeAction` owned by `Command` | **False** — **`AiRuntime/models/RuntimeAction.ts`**; `Command` exposes **`executeAppAction`**. |
| `resolveDsoNames` injects `add_track` via `splice` | **Confirmed** — `compileDso.ts` ~341–357. |
| `tryParseRawFunctionCalls` | **Confirmed** — `repositories/webLlm/toolCalling.ts` ~18–52. |
| DSO WebLLM on grammar error | **Throws** — `executeDsoEdit.ts` ~369–376 (not plain-text fallback). |
| `getProjectContext` + full prompt | **Memo** when store refs stable; **`JSON.stringify(workspaceContext)`** in chat system prompt (`sendChatMessage.ts` ~193–195). |
| `parseMidiResponse` | **Confirmed** — clamps types only (`llmMidiGeneration.ts` ~137–162). |
| `ChatPanel` scroll | **`useEffect([chatState?.messages])` + `scrollIntoView`** (~75–80) — frequent during streaming. |
| Native stack | **`src-tauri/src/commands/native_llm.rs`** + **`mistralrs`**, not `mistral.rs`. |

### Pass 2 (2026-04-14) — streaming + store mechanics

| Claim | Result |
|--------|--------|
| **PERF-1: one store update per token** | **Confirmed** — `sendChatMessage.ts` calls `updateChatMessage(assistantMsgId, …)` inside the streaming callback for **native** (~221), **cloud** (~235), and **WebLLM** (~263) on **every** token/delta. |
| **New `messages` array each update** | **Confirmed** — `chatStore.ts` `updateChatMessage` uses `messages: currentState.messages.map(...)` (~41–44), producing a **new array** and `chatStore.set({ ...currentState, ... })` on each call — any `useStore(chatStore)` subscriber re-renders. |
| **`useStore` granularity** | **Confirmed** — `useStore` (`useStore.ts`) uses `useSyncExternalStore(store.subscribeReact, () => store.getSnapshot() ?? defaultValue)` with **no** selector — full `ChatState` snapshot on every notify. |
| **Scroll `useEffect`** | **Re-confirmed** — dependency `[chatState?.messages]`; new array reference each token → effect runs frequently during streaming. |
| **`ReasoningBlock` a11y** | **Confirmed** — `ChatPanel.tsx` ~35–55: `<button>` with **no** `aria-expanded` / `aria-controls`. |
| **Deep `useCases/foo` in production** | **Refined** — not found outside `__tests__` / `*.spec.ts` (see §2 edit above). |

### Pass 3 (2026-04-14) — WebLLM worker, DSO gate, prompt path, Markdown cost

| Claim | Result |
|--------|--------|
| **WebLLM runs in a Worker** | **Confirmed** — `engineLifecycle.ts` ~70–90: dynamic `import('@mlc-ai/web-llm')` + `import('../llmWorker?worker')`, `new LlmWorker()`, `CreateWebWorkerMLCEngine(worker, …)` — inference is **not** on the main thread; main holds the engine handle only. |
| **DSO backend excludes cloud** | **Confirmed** — `isDsoBackendAvailable.ts` ~7–9: `backend === 'native' \|\| backend === 'webllm'` only; matches `parsePromptToActions` comment (~69–70) and `executeDsoEdit` `invokeLlm` (no cloud branch). |
| **Prompt mode → `executeDsoEdit`** | **Confirmed** — `parsePromptToActions.ts` ~71–73 calls `executeDsoEdit(prompt)` when `isDsoBackendAvailable()` after fast-path misses. |
| **§4.A: `ReactMarkdown` per message** | **Confirmed** — `ChatPanel.tsx` ~165–216 maps `chatState.messages`; assistant branch wraps content in `<ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>` — **every** parent re-render re-walks markdown for **all** messages (not only the streaming one). |
| **Orchestrator file size (sanity)** | **`sendChatMessage.ts`** ~296 lines; **`executeDsoEdit.ts`** ~422 lines (includes `invokeLlm`, `parseEditPlan`, `commitDsos`, etc.) — supports **CORE-1** “large entrypoints” without relying on line counts alone. |
| **`saveSnapshot` for DSO undo** | **Confirmed** — `executeDsoEdit.ts` `commitDsos` (~252–258) `bundleBefore` / `bundleAfter` via `saveSnapshot()` from `CrdtDocument` — **PERF-2** path unchanged. |
