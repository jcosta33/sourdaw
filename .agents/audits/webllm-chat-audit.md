# Audit: WebLLM Commands & Chat Implementation

## Goal
The goal of this audit is to assess the current state of the AI Chat and Command implementation, with a focus on WebLLM integration, context management, and user experience. The objective is to identify bottlenecks, architectural weaknesses, and areas for refinement to provide a world-class AI assistant within the DAW.

## Current State

### 1. Backend Orchestration
- **Backends:** Supports **Native** (Tauri/Rust), **Cloud** (Claude), and **WebLLM** (Browser/WebGPU).
- **Resolution:** Backend is resolved dynamically based on availability and user preference via `resolveBackend()`.
- **Loading:** WebLLM bundle (6.2MB) is dynamically imported only when needed. It uses a dedicated Web Worker (`llmWorker.ts`) to avoid blocking the main thread.

### 2. Context Management
- **DAW Context:** `getProjectContext()` serializes the current state (tracks, clips, devices, transport) into a JSON object.
- **Memoization:** Context is memoized based on store reference identities, preventing unnecessary rebuilding.
- **Chat History:** Capped at the last 24 messages (12 pairs) to stay within model context windows.

### 3. Inference & Execution
- **Chat Mode:** Open-ended conversation. Supports streaming for all backends.
- **Command Mode:** Interprets user intent via `parsePromptToActions` and executes `RuntimeAction`s through the command layer.
- **Reasoning:** Supports extraction of `<think>` blocks for models that output internal chain-of-thought (e.g., DeepSeek, Hermes).
- **Tool Calling:** WebLLM uses Hermes-3's native tool calling with a regex-based fallback parser (`tryParseRawFunctionCalls`).

### 4. UI/UX
- **Panel:** `ChatPanel.tsx` renders the chat history using Markdown (`react-markdown`).
- **Input:** `ChatComposer.tsx` handles input, mode toggling, and generation control.
- **Feedback:** `LlmStatusBadge.tsx` and `LmStatusStore` track loading and readiness.

---

## Findings

### F1: Brittle Tool Call Parsing (WebLLM)
- The fallback parser `tryParseRawFunctionCalls` in `toolCalling.ts` uses a simple regex: `/(\w+)\(([^)]*)\)/g`.
- **Impact:** It fails to handle complex arguments like nested objects, arrays, or strings containing commas/parentheses. This makes Command Mode unreliable when the model deviates from strict JSON tool calls.

### F2: Static Context Window Management
- History is hard-capped at 24 messages.
- **Impact:** In long sessions, the model loses memory of earlier instructions. There is no "summarization" or "vector-based retrieval" for long-term memory.

### F3: Large Context Overhead
- The entire `ProjectContext` is sent with every message.
- **Impact:** For large projects (e.g., 50+ tracks with hundreds of clips), the context JSON alone can consume thousands of tokens, potentially exceeding the context window of smaller models like Qwen 1.7B (WebLLM "Light").

### F4: UI Performance with Large Chat History
- `ChatPanel` uses `scrollIntoView({ behavior: 'smooth' })` on every message update.
- **Impact:** Can cause jittery behavior during high-speed streaming or when the user is trying to scroll up while the model is responding.

### F5: Architectural "God Function"
- `sendChatMessage.ts` handles backend branching, mode branching, message injection, history management, and error handling.
- **Impact:** Hard to test in isolation and difficult to extend with new backends or post-processing steps.

---

## Issues & Needed Improvements

| ID | Issue | Needed | Priority |
| :--- | :--- | :--- | :--- |
| 1 | Brittle tool call parsing | Implement a more robust parser or use a constrained output library to enforce JSON schemas more strictly for WebLLM. | High |
| 2 | Inefficient context injection | Implement "Relevant Context" selection. Only inject tracks/clips that are actually referenced or relevant to the current view/selection. | Medium |
| 3 | Static history cap | Replace the 24-message cap with a token-aware sliding window or a summarization strategy for older messages. | Medium |
| 4 | Jittery auto-scroll | Improve scroll management: use a "pinned to bottom" logic that only auto-scrolls if the user was already at the bottom. | Low |
| 5 | Monolithic chat logic | Refactor `sendChatMessage` into a backend-agnostic orchestrator with dedicated "Inference Providers" for Native, Cloud, and WebLLM. | Medium |

---

## Risks
- **Context Overflow:** Users with large projects will experience silent failures or hallucinated responses as context gets truncated by the model's internal limits.
- **Command Unreliability:** As we add more complex actions, the current regex-based tool parser will become a major bottleneck for the "Command Mode" feature.

## Suggested Approaches
- **RAG-Lite:** Instead of sending all tracks, send a summary (e.g., track names/counts) and full details only for the selected track or clips.
- **Constrained Decoding:** Explore using `GBNF` or similar grammars (if supported by the underlying MLC engine) to guarantee valid JSON/Tool-call output.
- **Virtualized Chat List:** If history limits are increased, use `react-window` or similar to keep the `ChatPanel` performant.

## Resolved
- (Initial Audit)
