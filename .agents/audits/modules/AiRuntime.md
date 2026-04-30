# AiRuntime module audit

## Scope

This audit covers `src/modules/AiRuntime/` in full — all use cases (LLM
orchestration, DSO editor, voice dictation, AI panel actions, mix-health,
prompt parsing, cloud-API management), handlers, repositories
(`cloudLlm/`, `webLlm/`, `nativeEngine/`, `voiceTauriAdapter/`,
`mcpToolAdapter/`, `llmWorker.ts`), services (`scaleTheory.ts`,
`fuzzySearch.ts`), transformers (`promptParser/`, `toolCallParser.ts`,
`toolSelector.ts`), models, stores, and presentations. It explicitly
excludes upstream callers (`Command`, `Workspace`, `Arrangement`,
`MIDI`, `Transport`, `AiGeneration`, `AudioAnalysis`) except where this
module imports from them directly, and the cross-module
`mcpToolAdapter` external surface.

It is an adversarial review: bugs, race conditions, security and trust
gaps, type-soundness escapes, AGENTS.md violations, dead/duplicated
abstractions, lazy tests, accessibility, UX hazards.

Related spec: none on disk.

---

## Goal

A correctness-and-trust-first AI runtime for the DAW:

- Backend selection (`native` / `webllm` / `cloud` / `none`) is
  reliable, single-shot, and never silently produces a stale "ready"
  state when the underlying engine is not.
- Every LLM-emitted action is validated against a runtime schema before
  it touches a store. The trust boundary is **before the handler runs,
  not after** — handlers are not the line of defense against
  hallucination.
- DSO planning never silently mutates the user's project beyond what
  was asked (no auto-creating tracks for "remove" requests, no
  defaulting unknown enums to "rock"/"pop"/"C", no `?? 60` for unknown
  note names).
- One `analyzeMix`-equivalent — there must be exactly one
  authoritative mix-analysis input to `mixHealthAnalysis`, and the
  prompt must contain real `\n` newlines, not literal backslash-n.
- Module-level mutable state is racing-safe (Promise-coalesced lazy
  init, no concurrent overwrite of model/engine handles, `activeAborter`
  not reachable from outside an AbortController-aware API).
- AGENTS.md hard rules: no `any`/`as any`/`as unknown as …`, no
  `React.memo`/`useMemo`/`useCallback`/`forwardRef`, no `&&` in JSX,
  no namespace imports, no positional multi-arg signatures, callback
  params named for what they are (`track`, `clip`, `note`) — not
  `time`, `alpha`, `node`, `data`, `context`, `length`, `state`.
- Tests verify behaviour, not "called the function with `null` returns
  `null`". Mocks point at the same import path the production code
  uses.
- A root `index.ts` exists and curates the module's external surface;
  cross-module callers do not deep-import `useCases`, `stores`, and
  `presentations/views` independently.

---

## Relevant code paths

- `src/modules/AiRuntime/` (no root `index.ts` — see issue #1)
- `src/modules/AiRuntime/useCases/index.ts` (cross-module use-case surface)
- `src/modules/AiRuntime/stores/index.ts` (cross-module store surface)
- `src/modules/AiRuntime/presentations/views/index.ts` (cross-module views)
- `src/modules/AiRuntime/useCases/sendChatMessage.ts`
- `src/modules/AiRuntime/useCases/parsePromptToActions.ts`
- `src/modules/AiRuntime/useCases/validateActions.ts`
- `src/modules/AiRuntime/useCases/validateActionPayload.ts`
- `src/modules/AiRuntime/useCases/getProjectContext.ts`
- `src/modules/AiRuntime/useCases/notifyAiChange.ts`
- `src/modules/AiRuntime/useCases/runAiActionWithToast.ts`
- `src/modules/AiRuntime/useCases/mixHealthAnalysis.ts`
- `src/modules/AiRuntime/useCases/aiHistoryActions.ts`
- `src/modules/AiRuntime/useCases/promptInjection.ts`
- `src/modules/AiRuntime/useCases/aiPanelActions/{runAppAction,toggleChat,undoLastAction}.ts`
- `src/modules/AiRuntime/useCases/llmOrchestration/{inference.ts,lifecycle/{initEngine.ts,unloadEngine.ts}}`
- `src/modules/AiRuntime/useCases/dsoEditor/{executeDsoEdit.ts,compileDso.ts,serializeLogicalState.ts,dsoPrompt.ts}`
- `src/modules/AiRuntime/repositories/cloudLlm/{keyManagement.ts,cloudInference/*}`
- `src/modules/AiRuntime/repositories/webLlm/{engineLifecycle.ts,toolCalling.ts}`
- `src/modules/AiRuntime/repositories/nativeEngine/{lifecycle.ts,completions.ts,streaming.ts}`
- `src/modules/AiRuntime/repositories/voiceTauriAdapter/*`
- `src/modules/AiRuntime/transformers/{toolCallParser.ts,toolSelector.ts,promptParser/parsing.ts}`
- `src/modules/AiRuntime/services/{fuzzySearch.ts,scaleTheory.ts}`
- `src/modules/AiRuntime/stores/{chatStore.ts,aiActionHistoryStore.ts,llmStatusStore.ts,mixAnalysisStore.ts,voiceStatusStore.ts}`
- `src/modules/AiRuntime/handlers/aiOrganization/{handleAutoOrganizeProject.ts,handleGetMentorTips.ts}`
- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`

---

## Current behavior

**No root barrel.** `src/modules/AiRuntime/index.ts` does not exist
(verified by `find -maxdepth 1 -type f` returning empty). The module
exposes three independent cross-module surfaces — `useCases/index.ts`,
`stores/index.ts`, `presentations/views/index.ts` — and external
consumers must deep-import each. Cross-module callers therefore know
the shape of the module, contradicting the AGENTS.md rule that the
"root `index.ts` is the sole **cross-module** public surface".

**Backend orchestration.** `resolveBackend` returns one of `'native' |
'webllm' | 'cloud' | 'none'`. `initEngine` initialises the resolved
backend; `generateToolCalls` iterates a fallback chain
(`getBackendChain`) and tries each backend until one succeeds.
`sendChatMessage` resolves once and sticks with that backend (no
fallback). `mixHealthAnalysis` ignores `resolveBackend` entirely and
calls `streamCloudChatCompletion` unconditionally.

**LLM-emitted action validation.** `parsePromptToActions` produces
`RuntimeAction[]` from preset/regex/compound fast paths, then via the
DSO editor for everything else. `validateActions` filters that array,
checking each action's type against `KNOWN_ACTION_TYPES` and (if a
guard exists) its payload against `PAYLOAD_VALIDATORS`. Of ~200 action
types, ~70% are marked `'unchecked'`, with the comment that handlers
"already check trackId" — that claim is not verified per-action and
not enforced anywhere.

**DSO editor.** `executeDsoEdit` invokes the LLM with a JSON-schema
constraint and parses the response. `compileDso.resolveDsoNames`
fuzzy-matches LLM-emitted human names (e.g. "Drums") to store IDs and,
on miss, **auto-creates a track and inserts a new `add_track` DSO
before the failing one** — including for `remove_*` ops.

**WebLLM lifecycle.** `engineLifecycle.ts:21-30` holds the engine,
`initPromise`, worker, and `activeModelId` in a single closure
holder. Concurrent init is coalesced via `engineState.initPromise`.
**Native lifecycle.** `nativeEngine/lifecycle.ts:19` uses
`{ ready: false }` with no Promise coalescing. **Cloud client.**
`cloudLlm/keyManagement.ts:14` holds `apiKey` and `client` in a
closure with no persistence — every reload requires re-entering the
key.

**Stores.** `chatStore` is initialised with non-null
`initialChatState` (see `chatStore.ts:14`), but every mutator
(`appendChatMessage`, `updateChatMessage`, `setChatGenerating`, …)
defensively checks `if (!currentState) { return; }` and silently
exits. `activeAborter` is a module-level mutable `let` next to
`chatStore`. `aiActionHistoryStore` persists to `localStorage` via
`createLocalStorage('sourdaw-ai-history')` — no multi-tab
synchronisation.

**Tests.** Coverage is broad (most public files have a `*.spec.ts`).

---

## Findings

1. **No root `index.ts`.** The module's public surface is split across
   three independent barrels. AGENTS.md ("Index exports — external
   consumers only") states the root `index.ts` is the sole cross-module
   surface. Today every external module imports from
   `#/modules/AiRuntime/useCases`, `#/modules/AiRuntime/stores`,
   `#/modules/AiRuntime/presentations/views` independently. This
   bypasses the architectural contract entirely.

2. **Pervasive bizarre callback parameter naming.** A grep across
   `src/modules/AiRuntime/` finds **57 occurrences** of callback
   parameters named `(time)`, `(alpha)`, `(node)`, `(data)`,
   `(context)`, `(state)`, `(length)`, `(message)`, `(message1)`,
   `(context1)`, `(beta)` — for callbacks that operate on
   `Track`, `Clip`, `Device`, `Note`, `RuntimeAction`, etc. This is
   the residue of a bulk identifier rename (likely an automated
   refactor) and now actively misleads readers — `(time) => time.id`
   for a track is not just ugly, it is wrong-domain. Examples:
    - `getProjectContext.ts:92` `tracks: (trackState?.tracks ?? []).map((time) => …)` — `time` here is a track.
    - `getProjectContext.ts:103` `time.clips.map((context) => …)` — `context` here is a clip.
    - `getProjectContext.ts:111` `time.devices.map((data) => …)` — `data` here is a device.
    - `notifyAiChange.ts:20` `changeListeners.filter((length) => length !== cb)` — `length` is a function reference.
    - `sendChatMessage.ts:127` `result.actions.map((alpha) => alpha.type)` — `alpha` is a `RuntimeAction`.
    - `sendChatMessage.ts:114,132` `executedLabels.map((length) => …)` — `length` is `{ action, label }`.
    - `compileDso.ts:232` `function levenshtein(alpha: string, b: string)` — both single-letter and renamed.
    - `compileDso.ts:290,297,304,330,720,825` track/clip/device callbacks named `time`, `context`, `data`, `context1`.
    - `inference.ts:33` `DAW_TOOL_SCHEMAS.map((time) => …)` — `time` is a tool schema.
    - `toolSelector.ts:131,141,153` `for (const time of tools)` and `allTools.filter((time) => …)`.
    - `serializeLogicalState.ts:223` `trackState.tracks.slice(0, 8).map((time) => time.name)`.
    - `validateActionPayload.ts:32-38` introduces `Extract2` (named to avoid shadowing TypeScript's `Extract`?).
   AGENTS.md "**Naming Constraints:** No single-letter variable
   names" is violated by `(g)`, `(b)`, `(r)`, `(qt)`, `(ct)` across
   `inference.ts:101`, `compileDso.ts:232,234,235,251`,
   `searchPresets`/`fuzzySearch.ts:54,87`, `aiActionHistoryStore.ts:45`.

3. **`validateActions` discards the type-guard return.**
   `validateActions.ts:266-270` casts `validator as (p: unknown) =>
   boolean` and calls it as a plain predicate. The whole point of
   `PayloadValidator<ActionType>` (a `payload is PayloadOf<ActionType>`
   guard) is the type-narrowing — discarding it forces every downstream
   handler to re-validate. The cast also defeats the
   `satisfies Record<RuntimeActionType, ...>` exhaustiveness check
   inside the function body: any future `'unchecked'` regression in a
   high-risk action would not surface here. The `Extract2` name in
   `validateActionPayload.ts:32` is also unidiomatic — TS already
   exports `Extract`; the `2` suffix suggests prior shadowing the
   author worked around rather than diagnosed.

4. **~70% of action types are `'unchecked'`, including destructive
   ones.** `validateActionPayload.ts:158-401` marks `'exportProject':
   'unchecked'` (only the optional `format` is checked above on line
   156, but `exportDawProject`, `saveProject`, `newProject` are
   unchecked), `'removeAllTracks': 'unchecked'`, `'leaveCollabSession':
   'unchecked'`, `'restoreDsoSnapshot': 'unchecked'`,
   `'restoreProjectVersion': 'unchecked'`, `'createCollabSession':
   'unchecked'`, `'loadPreset': 'unchecked'`, `'savePreset':
   'unchecked'`, all `generate*` actions, `'stemSeparate':
   'unchecked'`, `'searchSamples': 'unchecked'`. The justification
   ("trusted: handler already checks trackId") is not enforced
   anywhere — there is no test or compile-time linkage between this
   list and the handlers. `'restoreDsoSnapshot'` accepts an arbitrary
   binary `bundle` from the LLM with **no validation** before
   replacing project state. An LLM hallucinating
   `{ type: 'restoreDsoSnapshot', payload: { bundle: <garbage> } }`
   reaches the handler.

5. **`compileDso.resolveDsoNames` auto-creates tracks for failed
   `remove_*` ops.** `compileDso.ts:339-368` — when a DSO references
   a track by name and the name does not match anything, the code
   block at `:351-368` runs for **any** op that is not
   `'add_track'` (the array `['add_track']` is the only excluded
   one). For `remove_track`, `mute_track`, `solo_track`,
   `set_track_volume`, etc., a missed lookup auto-creates a track and
   prepends an `add_track` DSO. UX fallout: "delete the Bass track" —
   if there is no Bass track — silently creates one. This is not the
   "selected track" branch (`isSelectedRef`) and not the explicit
   `add_track` exception; it is the catch-all auto-create. The
   `kindFallback` heuristic uses substring `'drum'`/`'midi'` to pick
   `midi`, otherwise `audio`.

6. **`parseEditPlan` trusts the LLM-supplied JSON shape.**
   `executeDsoEdit.ts:216-219, 229-231` parses the LLM response and
   does `parsed.kind === 'edit_plan' && Array.isArray(parsed.dsos)`,
   then `return parsed as EditPlan` — **without validating the DSO
   shapes inside the array.** A model that returns
   `{ kind: 'edit_plan', dsos: [{ op: 'set_tempo', bpm: "fast" }] }`
   passes this gate. `validateDsos` (`compileDso.ts:433`) does run
   **after**, but the EditPlan structural fields (`moderation`,
   `intent`) are not re-validated, and the per-DSO op-discriminator
   path in `executeSingleDso` assumes the runtime values match the
   typed shapes (`dso.bpm`, `dso.gain`, etc. read directly without
   type checks beyond the validators that exist).

7. **`mixHealthAnalysis` writes literal `\n` instead of newlines.**
   `mixHealthAnalysis.ts:21,35-37,42-43,47` — every template-string
   line ends with `\\n\\n` or `\\n` inside a backtick literal. Those
   become the two-character sequence backslash+n in the rendered
   string sent to the LLM, not actual newlines. The LLM receives a
   single long line. The whole "Mix Data Overview" report is in fact
   one line of `\n`-separated text in the prompt. This is a bug, not
   a stylistic concern.

8. **`mixHealthAnalysis` is cloud-only.** `mixHealthAnalysis.ts:64`
   calls `streamCloudChatCompletion` directly, ignoring
   `resolveBackend`. If the user's backend is `native` or `webllm`,
   the action does nothing visible (or fails with "Cloud AI not
   configured").

9. **`isCloudAvailable` checks for an in-memory key, not an in-memory
   key + reachable network.** `keyManagement.ts:28-30` returns true if
   `apiKey !== null && client !== null`. `initEngine.ts:45-49` uses
   this to set `state: 'ready', modelId: 'claude'` as a fallback
   without verifying the key works. A user with a stale/revoked key
   sees "ready" until the first request fails.

10. **`initEngine` mis-signals readiness on WebLLM fallback.**
    `initEngine.ts:34-43` — when native fails and WebGPU is available,
    the code sets `{ state: 'loading', text: 'Native AI unavailable —
    loading WebLLM...' }` and `await initWebLlmEngine(modelId)`, then
    `return`. `initWebLlmEngine` itself sets `{ state: 'ready' }` on
    success — but if `initWebLlmEngine` throws, the catch in
    `initWebLlmEngine` (`engineLifecycle.ts:100`) sets `state: 'error'`
    and resets the holder. The outer `initEngine` does not surface
    that error to its caller — `await` propagates it, so callers see
    a rejected promise; but the cloud branch at `initEngine.ts:45-49`
    is unreachable in this code path because `isCloudAvailable()` is
    only consulted **after** WebGPU detection. Users with native-fail
    + WebGPU + cloud-key configured do not get a cloud fallback.

11. **`initEngine` race on second call.** `initEngine.ts` does not
    coalesce concurrent initialisations. Two simultaneous calls both
    proceed past the `'idle'`-only guard (there is none) and both run
    `initNativeEngine` / `initWebLlmEngine`. `initWebLlmEngine` itself
    coalesces (line 52), but `initNativeEngine` does not (uses a
    plain `nativeEngineState.ready` boolean), so two parallel Tauri
    `init_native_llm` invocations are possible.

12. **`activeAborter` is a module-mutable `let` next to `chatStore`.**
    `chatStore.ts:5` declares `let activeAborter: AbortController |
    null = null;` at module scope — racing-unsafe, not bound to any
    user/session, and not exposed as part of the store. Two
    concurrent `sendChatMessage` calls overwrite each other's aborter
    silently; calling `stopGenerating` (`:109`) only aborts the
    most-recently-set one. A reasoning UI that triggers a chat send
    while a prompt-mode `parsePromptToActions` is mid-flight will
    leak the in-flight aborter.

13. **`chatStore` mutators silently swallow `undefined` state.**
    `chatStore.ts:22-31` (`appendChatMessage`), `:36-48`
    (`updateChatMessage`), `:53-63` (`setChatGenerating`), `:65-75`
    (`clearChatMessages`), `:81-90` (`toggleReasoning`), `:95-104`
    (`setChatMode`) all early-return on `if (!currentState)`. The
    store is initialised with non-null `initialChatState`
    (`chatStore.ts:7-12`), so the only path to `undefined` is a
    deliberate `chatStore.set(undefined)`. The defensive checks make
    that scenario silently no-op instead of throwing — hiding the
    bug instead of surfacing it. Same pattern in
    `aiActionHistoryStore.ts:30,39-40,50-51,58-60`,
    `mixAnalysisStore.ts:21-23`.

14. **`mixAnalysisStore` lives in `AiRuntime/stores/` but the
    canonical analysis use case lives in `AudioAnalysis`.** This is
    flagged in the AudioAnalysis audit (cross-module concern). The
    AiRuntime side reads the mix-analysis state and the cross-module
    store is the only allocator. The boundary should be one or the
    other, not split — ownership is unclear.

15. **`runAppAction.ts:9` casts away DI return type.** The comment
    "executeAppAction is typed as `any` via the inject() DI pattern"
    is itself a confession that the DI infrastructure leaks `any`
    into call sites. AGENTS.md "TypeScript — soundness" forbids `as
Promise<void>` to silence the compiler. The `any` upstream needs
    fixing in `inject()`/`#/utils/createHandler`, not papered over
    here.

16. **`runAppAction`, `toggleChat`, `undoLastAction` are five-line
    pass-throughs.** `aiPanelActions/runAppAction.ts:7-10`,
    `toggleChat.ts:3-5`, `undoLastAction.ts:3-5` re-export
    Command/Workspace use cases as is. AGENTS.md "One Function Per
    File" is satisfied cosmetically; the directory adds no value
    over a direct `import { toggleChatPanel } from
'#/modules/Workspace/useCases'` at the call site.

17. **`aiHistoryActions.ts` violates the "one function per file"
    naming convention.** AGENTS.md "Each `useCase` and `repository`
    file must export exactly ONE function" is followed (one export:
    `revertAiActionGroup`), but the filename is the legacy plural
    name. Should be `revertAiActionGroup.ts`.

18. **`getProjectContext` cache uses object-identity but stores
    cache values via private mutation.** `getProjectContext.ts:52-64`
    declares a module-level mutable cache. The cache is correct as
    long as stores never mutate in-place (which they don't), but the
    cache is **shared across all callers** — meaning two unrelated
    consumers each get the same cached `ProjectContext` object. If
    one consumer mutates the returned context (e.g. by sorting
    `tracks`), the next consumer observes the mutation. The returned
    object is also typed `ProjectContext` (mutable) — should be
    `Readonly<ProjectContext>` or returned via structuredClone if
    callers might mutate.

19. **`extractThinkBlock` regex backtracks on long streams.**
    `sendChatMessage.ts:30` uses `/^\s*<think>([\s\S]*?)<\/think>\s*/`
    — non-greedy with `$\s*$` trailing — which on a long incoming
    streamed response with no closing tag falls through to the
    partial branch (`:39`). For a 2 048-token native completion
    streaming character-by-character, this regex runs **per token**
    on the entire accumulated string. Quadratic behaviour in the
    chat update loop. WebLLM streaming (`:267-272`) does the same.

20. **Streaming code path uses `as` casts on engine generators.**
    `sendChatMessage.ts:255,260` casts the WebLLM streaming response
    to `AsyncIterable<{ choices: Array<{ delta: { content?: string
} }> }>` without runtime validation. Same pattern at
    `executeDsoEdit.ts:358,381`, `streaming.ts:98`, `completions.ts:21,43`.
    These are I/O boundaries and OK to type — but no runtime guard
    catches a different shape. AGENTS.md prefers `unknown +
narrowing` at I/O boundaries.

21. **`parseToolCallXml` accepts any LLM response containing JSON.**
    `toolCallParser.ts:31` splits on `<tool_call>`/`<function>` and
    feeds every `{` line through `JSON.parse`. A line like
    `{"name":"removeAllTracks","arguments":{}}` embedded in a Markdown
    code block in the LLM's "explanation" will be executed. There
    is no guard that the parsed `name` is a valid `RuntimeActionType`
    — that lives downstream in `validateActions`, but tool-call
    name → action type is not 1:1 (tool names are MCP-shaped, action
    names are camelCase). The trust boundary is implicit.

22. **`coerceToolCall` falls back to `parameters` silently.**
    `toolCallParser.ts:111` `(obj.arguments ?? obj.parameters ?? {})`
    — masks the difference between OpenAI / Llama / Hermes formats
    rather than detecting the format and erroring on unknown shapes.
    A model that emits `{name:'X', input:{…}}` (Anthropic-style)
    silently degrades to `arguments: {}`.

23. **`compileDso.toMelodyStyle` / `toScaleType` / `toChordStyle` /
    `toChordVoicing` / `toDrumStyle` silently default unknown enums.**
    `compileDso.ts:140-158` — `toMelodyStyle('lydian-mode')` returns
    `'simple'`. `toScaleType('flubbastor')` returns `'major'`.
    `toChordStyle('country')` returns `'pop'`. `toChordVoicing('mu')`
    returns `'close'`. `toDrumStyle('disco')` returns `'rock'`. An
    LLM that hallucinates style names produces musically-wrong
    output silently. There is no log, no notification, no error.

24. **`noteNameToMidi` defaults to C4 for unknown notes.**
    `compileDso.ts:55` returns `60` for any name not in the table.
    `noteNameToMidi('Z')` is C4. The DSO `key` field is therefore
    silently corrupted by hallucination. Combined with #23, an
    LLM-output `{ op: 'generate_melody', key: 'XX', scale: 'flubba'
}` becomes "C major simple melody" with no warning.

25. **`compileDso.executeDsos` swallows all per-DSO errors.**
    `compileDso.ts:947-954` `try { await executeSingleDso(dso, ctx);
summaries.push(describeDso(dso)); } catch (error) { logger.warn(...) }`
    — failed DSOs are dropped silently from the summary array. The
    user's "Done!" toast (via `executeDsoEdit.ts:289`) implies all
    DSOs ran. Partial application without surfacing the failures is
    a UX hazard, especially for destructive batches (e.g. five
    removes succeed, two fail — the user sees "5 removes done" with
    no indication two failed).

26. **`add_midi_notes` DSO executes outside the action pipeline.**
    `compileDso.ts:821-849` directly mutates `midiStore` instead of
    going through an `AppAction`. This means: no payload validation
    (`PAYLOAD_VALIDATORS` not consulted), no action history entry,
    no undo via the standard Command path (the DSO snapshot
    `transactSnapshot` covers it, but the per-action label does
    not). Same pattern at `:780-792` (`set_time_signature` mutates
    `transportStore` directly), `:721-734` (`duplicate_clip` calls
    `addClip` directly without payload validation).

27. **DSO-execute error reporting uses console-shaped string
    interpolation.** `compileDso.ts:952` `logger.warn(\`Failed to
execute DSO ${dso.op}:\`, error)` — the `, error` second-argument
    relies on `appLogger.warn` accepting variadic args; if it does
    not, the error object is dropped. (Verify with the logger's
    actual signature; many wrapped loggers accept only a single
    message string.)

28. **`activeModelId` and DSO finish hard-code `'qwen3-8b'`.**
    `executeDsoEdit.ts:193` `llmStatusStore.set({ state: 'ready',
modelId: 'qwen3-8b' })`. The actual active model id is
    `getActiveModelId()` (returns the WebLLM-configured model). For
    a native backend, the model id should come from the engine, not
    a string literal.

29. **Cloud SDK `dangerouslyAllowBrowser: true` with no key
    persistence policy enforced.** `keyManagement.ts:23` sets
    `dangerouslyAllowBrowser: true` for `Anthropic` and the comment
    at `:6-13` says "Do NOT persist the key in a way that survives
    page reloads without explicit user consent". `setCloudApiKey`
    does not enforce this — the persistence layer (the consumer in
    `cloudApiManagement/configureCloudApi`) is what decides. The
    JSDoc warning is not a guarantee. `cloudAuth.client` instance
    (a `new Anthropic`) is also held in module scope and never
    explicitly destroyed on `clearCloudApiKey` — `client = null`
    drops the reference but does not abort in-flight requests.

30. **`generateNativeToolCalls` and `streamNativeCompletion` use
    boundary `as` casts without runtime validation.**
    `inference.ts:42-44` `(await tauriInvoke('native_tool_calling',
…)) as Array<{ name: string; arguments: Record<string, unknown>
}>`. No runtime check that the returned shape matches; a Rust-side
    serialization error or schema drift produces a
    `TypeError: Cannot read property 'name' of undefined` deep
    inside the loop. AGENTS.md "TypeScript — soundness ... runtime
    validation at I/O boundaries (e.g. Zod)".

31. **`browser dev mode` SSE parser swallows malformed chunks.**
    `streaming.ts:103-105` and `completions.ts:38-40` — try/catch
    around `JSON.parse` of SSE data with empty `catch {}`. A model
    that streams a malformed chunk in the middle silently drops
    tokens until the next valid chunk. No log.

32. **`tryPresetMatch` always returns the first match, no
    confidence floor.** `parsing.ts:73`
    `findBestMatch(normalized, context)` returns the highest-scoring
    preset above 50. `parsePromptToActions.ts:41` then sets
    `confidence: 0.95` regardless of the actual match score. The
    "0.95" is a hard-coded constant unrelated to the score —
    misleading downstream consumers if they ever inspect
    `result.confidence`.

33. **`isComplexPrompt` heuristics overlap and conflict with
    fast-path patterns.** `parsing.ts:18-64` — patterns like `/\b(blues|
jazz|rock|...)\b/i` send "I want a rock song" to the LLM, but
    the same `'rock'` keyword is also a `DRUM_STYLE_MAP` key. The
    fast path `tryPresetMatch` runs **before** `isComplexPrompt`
    inside it (`parsing.ts:69`), so a preset literally named
    "rock" would short-circuit. The interaction is implicit and
    not tested.

34. **`generateWebLlmCompletion` casts the response shape.**
    `engineLifecycle.ts:156-158` casts to
    `{ choices: Array<{ message: { content: string } }> }` without
    a runtime check. WebLLM versions that return different shapes
    (or future tool-calling envelopes) silently break.

35. **`engineLifecycle.ts:94` uses `as unknown as WebLlmEngine`** —
    AGENTS.md forbidden, with an `eslint-disable-next-line
sourdaw/no-type-assertion-escape` and a justification ("WebWorkerMLCEngine
    and WebLlmEngine are structurally compatible subsets"). The
    underlying fix — replace `WebLlmEngine` with a structural type
    derived from `@mlc-ai/web-llm`'s public types — has not been
    done; the author opted out of the rule via comment.

36. **`engineLifecycle.ts:100-104` "catch and reset" leaks the rejection.**
    The pattern `engineState.initPromise.catch((error) => { … set
state, reset; })` runs **alongside** the returned promise. If
    the caller does not also `.catch`, the error is unhandled at
    the caller level. Better: `await` inside an `async` IIFE so
    `engineState.initPromise.catch` does not double-handle.

37. **`unloadWebLlmEngine` does not clear `activeModelId`.**
    `engineLifecycle.ts:117-119` resets `engine`/`initPromise` but
    leaves `activeModelId` set to the previously-loaded model.
    `unloadEngine().then(() => initEngine())` in WebLLM mode then
    short-circuits (`initWebLlmEngine.ts:43` returns
    `Promise.resolve(engineState.engine)` only if the same
    `targetModel` matches an existing engine — but `engine` is
    null, so this branch is skipped; the call falls through). This
    is correct only because of the `engine !== null` guard; if the
    guard is ever loosened, you get a stale-model-id race.

38. **`isWebLlmLoaded` and `getLlmEngine` expose the same `null`
    check twice.** `engineLifecycle.ts:123-129` — duplicate API
    surface. Consumers race: one tab does `if (isWebLlmLoaded()) {
const e = getLlmEngine()!; … }` and the holder is unloaded
    between the two calls.

39. **`mcpToOpenAiTools` is the only consumer of
    `mcpToolAdapter/`.** `generateCloudToolCalls.ts:5,22` uses it.
    The adapter exists for an MCP→OpenAI conversion that, in
    practice, is consumed once. The other two adapter files
    (`mcpToCompactPromptText.ts`, `helpers.ts`) need
    investigation to confirm they are not dead exports.

40. **Voice-recording window-cast pattern.** `useVoiceRecording.ts:46`
    `const w = window as WindowWithSpeechRecognition` — boundary
    cast; OK in principle. `:55-56` `(w.SpeechRecognition ??
w.webkitSpeechRecognition)` is fine. But the
    `SpeechRecognitionInstance` type at `:24-34` is hand-rolled and
    will drift from the actual DOM `SpeechRecognition` type. The
    DOM lib types should be referenced if the target lib level
    permits it, otherwise the hand-rolled type belongs in a
    `WebSpeechApi.ts` model with a comment naming the spec.

41. **`React.memo` import in a chat panel.** `ChatPanel.tsx:9`
    imports `memo` from React. AGENTS.md "Do not use `useMemo`,
`useCallback`, or `React.memo` — the React Compiler handles
    memoization." Confirmed violation.

42. **No progress feedback for multi-step DSO planning.**
    `executeDsoEdit.invokeLlm` updates the chat message with
    "Planning... (N tokens)" every 15 tokens. There is no
    `aria-live` region, no progress percentage, no indication of
    backend (cloud / native / webllm). The chat message is the
    only feedback channel. For a streaming generation that runs
    30–90 seconds in WebLLM mode, this is brittle (#42 is mostly
    a UX/accessibility concern, but combined with #25 above it
    means failed planning emits no user-visible signal).

43. **`KNOWN_ACTION_TYPES_MAP` and `PAYLOAD_VALIDATORS` are two
    separate exhaustive `satisfies` records.**
    `validateActions.ts:12-241` and `validateActionPayload.ts:71-404`
    both list every action type. They drift independently — adding
    a new `RuntimeActionType` requires updating two
    `satisfies`-checked maps; if one is missed the compiler catches
    it, but the duplication itself is a maintenance burden. Combine
    into a single map.

44. **Defaults written into the LLM-emitted DSOs are unsafe for
    `bpm`/`gain` ranges.** `compileDso.ts:778`
    `Math.max(20, Math.min(999, dso.bpm))` clamps to [20, 999] but
    `validateDsos.ts:509` rejects out-of-range tempos. Either the
    validator's range (20–999) is correct and the clamp is dead, or
    the validator is wrong and the clamp is the real ceiling.
    Decide one. (The validator runs first, so the clamp is dead
    code.)

45. **`compileDso.executeDsos` runs DSOs sequentially with no
    cancellation.** `compileDso.ts:943-957` — there is no
    `AbortSignal` plumbed in. A DSO plan that takes 30 seconds
    cannot be cancelled. Combined with `setChatGenerating(true)`
    locking new sends in `sendChatMessage.ts:73`, the user is
    stuck.

46. **`handleAutoOrganizeProject` emits `_*` field convention
    elsewhere.** `IntentResult` has `_jsonEditApplied`,
    `_jsonEditAttempted`, `_jsonEditSummaries` (`parsePromptToActions.ts:91-101`).
    Underscore-prefixed fields are a private-marker convention
    that conflicts with TypeScript's structural typing — they are
    public on the type and consumers can read them. If the
    intent is "transient out-of-band signalling", model it as a
    discriminated union (`{ kind: 'jsonEdit', summaries: string[] }`
    vs `{ kind: 'actions', actions: RuntimeAction[] }`) rather
    than optional underscore fields.

47. **`mixHealthAnalysis` has both `\\n` literals AND an emoji
    elsewhere.** `handleGetMentorTips.ts:11` interpolates a `🎓`
    emoji in a notification string. Not a hard rule violation in
    code (the rule is about authored docs/files), but combined with
    AGENTS.md style sensitivity it is worth flagging for the i18n
    pass — emoji in user-visible strings shouldn't be hard-coded.

48. **`aiActionHistoryStore` `localStorage` race across tabs.**
    `aiActionHistoryStore.ts:24` persists via
    `createLocalStorage('sourdaw-ai-history')`. Two tabs both push
    AI action groups → the second-to-write wins, the first tab's
    actions vanish from the history list (in-memory state diverges
    from storage). Either subscribe to `storage` events or scope
    the history per-session.

49. **`scaleTheory.chordFromDegrees` uses single-letter `dur`,
    `vel`, `dp` parameters and `dp[index]![jIndex]!`-style
    non-null assertions in the Levenshtein.** `scaleTheory.ts:73`
    `(deg) => …` — `deg` is at the boundary of acceptable;
    `compileDso.ts:248` chains `dp[index - 1]![jIndex]!,
dp[index]![jIndex - 1]!, dp[index - 1]![jIndex - 1]!` —
    eight non-null assertions on a single line. Index-checked logic
    can be expressed without assertions if the loops are
    `0 <= index <= message`-bounded and the array is created
    `length: message + 1` (which it is); the assertions are an
    artefact of TS's noUncheckedIndexedAccess, but they hide any
    future indexing bug.

50. **`AiTaskResultCard` imports from another module's
    `useCases`.** `AiTaskResultCard.tsx:7` `import { removeTask }
from '#/modules/AiGeneration/useCases'`. This is allowed
    (cross-module barrel) but the card is a presentation component
    that mutates a different module's state directly. If
    `removeTask` is a use case, it should be invoked via the AI
    runtime's own task-management surface, or the card should be
    moved to `AiGeneration/presentations/`.

51. **No `aria-live` on chat streaming output.** `ChatPanel.tsx`
    streams assistant content into a regular div. Screen readers
    receive no announcement of new content. For an AI-first UI this
    is a significant accessibility gap.

52. **Tests cover the use cases, but with extensive `vi.mock` of
    cross-module barrels.** Spot-checked: spec files mock
    `#/modules/Command/useCases`, `#/modules/Workspace/useCases`,
    etc. The mocks are inert if the production import path
    differs (the AudioAnalysis audit found four such cases).
    Recommend a sweep — the same risk exists here given the depth
    of cross-module imports.

---

## Priorities

1. **Trust gap: ~70% of action types are `'unchecked'`, several are
   destructive** (issue #4). An LLM hallucination producing
   `restoreDsoSnapshot`, `removeAllTracks`, `exportDawProject`,
   `loadPreset`, or any `generate*` action lands in the handler
   unvalidated.
2. **DSO auto-creates tracks when "remove" fails name resolution**
   (issue #5). User says "delete Bass", no Bass exists, system
   creates a Bass track.
3. **`mixHealthAnalysis` sends backslash-n literals to the LLM
   prompt** (issue #7). Whole feature outputs broken markdown.
4. **No root `index.ts` on the module** (issue #1). External
   consumers deep-import three independent surfaces; AGENTS.md
   cross-module contract is bypassed.
5. **`parseEditPlan` doesn't validate DSO shapes inside the array**
   (issue #6). Per-DSO validators run, but the wrapper structure
   (`kind`, `moderation`, `intent`) and unknown-op handling are
   unguarded.
6. **`activeAborter` is module-mutable; concurrent sends overwrite**
   (issue #12). Cancel button can abort the wrong stream.
7. **`compileDso` silently defaults unknown enums and note names**
   (issues #23, #24). Hallucination produces musically-wrong output
   with no signal.
8. **`runAppAction` casts away DI `any`** (issue #15). The DI
   pattern leaks `any` into call sites — a soundness escape that
   propagates.
9. **`mixHealthAnalysis` is cloud-only** (issue #8). Native and
   WebLLM users get nothing or an error.
10. **57 callbacks named `(time)` / `(alpha)` / `(node)` / `(data)`
    / `(context)` for `Track` / `Clip` / `Device` / `Note` / `Action`
    callbacks** (issue #2). Active misleading code; AGENTS.md naming
    rules violated.

---

## Open issues

### 1. No root `index.ts` for the module

**Problem:** `src/modules/AiRuntime/` has no `index.ts`. External
consumers import directly from `useCases/`, `stores/`,
`presentations/views/` independently. AGENTS.md "Index exports —
external consumers only" specifies the root `index.ts` is the sole
cross-module surface. Today the surface is implicit and split.

**Representative files:**

- `src/modules/AiRuntime/` (missing `index.ts`)
- `src/modules/AiRuntime/useCases/index.ts:1-65`
- `src/modules/AiRuntime/stores/index.ts:1-21`
- `src/modules/AiRuntime/presentations/views/index.ts:1-10`

**Needed:** Create `src/modules/AiRuntime/index.ts` that re-exports
the curated set from `useCases/`, `stores/`,
`presentations/views/` and (if any cross-module event types exist)
`events/`. Then run `pnpm deps:validate` and migrate external
deep-imports to the root barrel. Per AGENTS.md, no `type` re-exports
through the use-cases path.

### 2. ~70% of action types are `'unchecked'`, including destructive ones

**Problem:** `PAYLOAD_VALIDATORS` marks many high-risk actions as
`'unchecked'`: `restoreDsoSnapshot`, `removeAllTracks`,
`exportDawProject`, `saveProject`, `newProject`, `loadPreset`,
`savePreset`, all `generate*` actions, `stemSeparate`,
`searchSamples`, `setMidiOutput`, `setControlSurface`. The justifying
comment "trusted: handler already checks trackId" is not enforced
anywhere — there is no compile-time linkage between this list and
handler-side validation. An LLM that hallucinates
`{ type: 'restoreDsoSnapshot', payload: { bundle: <garbage> } }`
reaches the handler.

**Representative files:**

- `src/modules/AiRuntime/useCases/validateActionPayload.ts:158-401`
- `src/modules/AiRuntime/useCases/validateActions.ts:266-270` (also
  discards the type-guard return)

**Needed:** Audit the destructive subset — `remove*`, `restore*`,
`export*`, `import*`, `load*`, `save*`, `new*`, `connect*`,
`disconnect*`, `clear*`, `delete*`, `generate*`, `stem*`,
`search*` — and add real payload validators for each. Replace the
`'unchecked'` sentinel with a typed marker that also names which
handler is responsible (e.g.
`'validatedByHandler' as const satisfies HandlerName<…>`). Fix
`validateActions.ts:266-270` to use the type guard's narrowing.

### 3. DSO `resolveDsoNames` auto-creates tracks for `remove_*` ops on miss

**Problem:** When LLM-emitted track names fail fuzzy matching,
`resolveDsoNames` prepends an `add_track` DSO and reroutes the
target to the new track, **for any op that is not `add_track`**.
This includes `remove_track`, `mute_track`, `set_track_volume`, etc.
"Delete Bass" with no existing Bass creates one.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:339-368`

**Needed:** Auto-create only for ops that semantically create state
(`add_clip`, `insert_device`, etc.). For `remove_*` / `mute_*` /
`solo_*` / `set_track_*` etc., return a `DsoValidationError` so
`executeDsoEdit` surfaces "Could not find track 'Bass'" via the
chat. Add a regression test covering "remove Bass" with no Bass
track.

### 4. `mixHealthAnalysis` writes literal `\n` in the prompt

**Problem:** Template-literal lines use `\\n\\n` and `\\n`
(double-escaped backslash-n) instead of real newlines. The LLM
receives a single un-broken line of "Mix Data Overview" followed by
all track summaries concatenated with literal backslash-n. The mix
report is unreadable.

**Representative files:**

- `src/modules/AiRuntime/useCases/mixHealthAnalysis.ts:21,35-37,42-43,47`

**Needed:** Replace `\\n` with `\n` (or use template-literal real
newlines `${'\n'}` if escaping pressure). Add a snapshot test on
the constructed prompt that asserts at least N newlines.

### 5. `parseEditPlan` trusts the LLM-supplied JSON shape

**Problem:** `executeDsoEdit.parseEditPlan` checks
`parsed.kind === 'edit_plan' && Array.isArray(parsed.dsos)` and then
`return parsed as EditPlan`. The DSO entries inside the array are
not validated until `validateDsos` runs against the resolved IDs.
The wrapper fields (`moderation`, `intent`) and unknown-op
discriminators are also unchecked.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:216-219,229-231`

**Needed:** Add a Zod (or hand-rolled exhaustive) schema for
`EditPlan` and validate before any downstream use. The schema must
reject DSOs whose `op` is not in the `Dso` discriminated union.
Drop the `as EditPlan` cast.

### 6. `mixHealthAnalysis` is cloud-only — bypasses backend resolution

**Problem:** Calls `streamCloudChatCompletion` unconditionally. If
the user's resolved backend is `native` or `webllm`, the action
fails or does nothing.

**Representative files:**

- `src/modules/AiRuntime/useCases/mixHealthAnalysis.ts:64-71`

**Needed:** Route through `resolveBackend` and call the appropriate
streaming API. Add a guard: if no backend is available, emit a
useful "AI not configured" toast.

### 7. `runAppAction` casts away DI `any`

**Problem:** `executeAppAction` is typed as `any` via `inject()`'s
DI pattern. The wrapper casts the return to `Promise<void>`. The
fix is in `inject()` (or the handler infra), not here.

**Representative files:**

- `src/modules/AiRuntime/useCases/aiPanelActions/runAppAction.ts:7-10`

**Needed:** Audit `#/infra/di/inject` for the `any` leak. If
`inject()` cannot preserve the wrapped function signature, replace
or augment it. Once the upstream returns a typed signature, drop
the cast here.

### 8. `activeAborter` is a module-mutable `let` next to chatStore

**Problem:** `let activeAborter: AbortController | null = null;` at
module scope. Two concurrent `sendChatMessage` calls overwrite each
other's aborter. The `stopGenerating` function only aborts the
most-recently-set one. State is not part of the store, not part of
any session, and cannot be inspected.

**Representative files:**

- `src/modules/AiRuntime/stores/chatStore.ts:5,109-121`

**Needed:** Move the aborter onto `chatStore` state (or a sibling
`chatGenerationStore`). Use a Map keyed by `requestId` if multiple
concurrent generations are valid, or reject second-send while the
first is generating. Add a test for two concurrent sends.

### 9. `compileDso` silently defaults unknown enums and note names

**Problem:** `toMelodyStyle('lydian-mode')` → `'simple'`,
`toScaleType('flubba')` → `'major'`, `toChordStyle('country')` →
`'pop'`, `toDrumStyle('disco')` → `'rock'`,
`noteNameToMidi('Z')` → `60` (C4). LLM hallucinations produce
silently-wrong music. No log, no toast.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:140-158`
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:54-56`

**Needed:** Either reject unknown enum values at the validator stage
(`validateDsos`), or log+notify when defaulting (`Unknown style
"flubba" — defaulted to "simple". The LLM may have hallucinated.`).
Pair with a regression test feeding bad enum values through the
pipeline.

### 10. `executeDsos` swallows per-DSO failures into `logger.warn`

**Problem:** Failed DSOs are dropped from the summary array. The
chat message says "Done!" with the surviving summaries. Partial
application is not surfaced to the user.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:947-954`
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:289`

**Needed:** Track failed DSOs separately. Surface them in the chat
message ("Done with 3 changes. 2 failed: …"). For destructive
batches, consider rolling back the whole transaction via
`transactSnapshot`.

### 11. `aiActionHistoryStore` localStorage race across tabs

**Problem:** `aiActionHistoryStore` persists to localStorage with
no cross-tab synchronisation. Two tabs that push action groups
overwrite each other.

**Representative files:**

- `src/modules/AiRuntime/stores/aiActionHistoryStore.ts:22-25`

**Needed:** Subscribe to `window.storage` events and reconcile
across tabs, or scope the history per-tab via `sessionStorage`.

### 12. `chatStore` mutators silently swallow `undefined` state

**Problem:** Every mutator early-returns on `if (!currentState)`.
The store is initialised with non-null `initialChatState`, so this
never fires unless someone explicitly calls `chatStore.set(undefined)`.
The defensive code masks the bug.

**Representative files:**

- `src/modules/AiRuntime/stores/chatStore.ts:22-31,36-48,53-63,65-75,81-90,95-104`
- `src/modules/AiRuntime/stores/aiActionHistoryStore.ts:30-35,38-47,49-55,57-63`
- `src/modules/AiRuntime/stores/mixAnalysisStore.ts:19-25`

**Needed:** Type the store as `Store<ChatState>` (non-nullable),
not `Store<ChatState | undefined>`. Replace the early-returns with
typed access. If the underlying `createStore` cannot enforce
non-nullable, fix it there.

### 13. `validateActions` discards the type-guard return

**Problem:** Casts `validator as (p: unknown) => boolean`,
discarding the `payload is PayloadOf<ActionType>` narrowing. The
type assertion at `:266` defeats the whole point of the
`PayloadValidator<ActionType>` design.

**Representative files:**

- `src/modules/AiRuntime/useCases/validateActions.ts:264-272`

**Needed:** Use the typed lookup directly:
`const validator: PayloadValidator<typeof action.type> | 'unchecked'
= PAYLOAD_VALIDATORS[action.type]; if (validator !== 'unchecked'
&& !validator(action.payload)) { … }`. The narrowing then flows
into the surviving filter result.

### 14. `parseToolCallXml` accepts any JSON-shaped substring

**Problem:** Splits on `<tool_call>`/`<function>` and parses every
`{`-prefixed line. Markdown explanations containing JSON are
executed. There is no guard that the parsed `name` corresponds to
a valid `RuntimeActionType` / tool name.

**Representative files:**

- `src/modules/AiRuntime/transformers/toolCallParser.ts:31-49,57-96`

**Needed:** Restrict parsing to content explicitly delimited by
the expected XML tags. Reject inline JSON inside markdown unless
it is fenced as `<tool_call>` or matches a known tool-name set.
Consult `KNOWN_ACTION_TYPES` (or a tool-name registry) before
emitting a `ToolCallResult`.

### 15. `ChatPanel` imports `memo` (forbidden)

**Problem:** AGENTS.md "Do not use `useMemo`, `useCallback`, or
`React.memo`". `ChatPanel.tsx:9` imports `memo`.

**Representative files:**

- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx:9`

**Needed:** Remove `memo` and any `memo()`-wrapped exports. Trust
the React Compiler for memoisation.

### 16. Pervasive bizarre callback parameter names

**Problem:** 57 occurrences of callback parameters named `(time)`,
`(alpha)`, `(node)`, `(data)`, `(context)`, `(state)`, `(length)`,
`(message)`, `(message1)`, `(context1)` for callbacks that receive
`Track`, `Clip`, `Device`, `Note`, `RuntimeAction`,
`ToolSchema`, etc. Active misleading code, almost certainly the
artefact of an automated rename that mapped legacy single-letter
identifiers onto a wordlist. Pair with single-letter parameter
names (`(g)`, `(b)`, `(r)`, `(qt)`, `(ct)`).

**Representative files:**

- `src/modules/AiRuntime/useCases/getProjectContext.ts:92,103,111`
- `src/modules/AiRuntime/useCases/notifyAiChange.ts:20`
- `src/modules/AiRuntime/useCases/sendChatMessage.ts:114,127,132,207`
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:232,290,297,304,330,720,825`
- `src/modules/AiRuntime/useCases/dsoEditor/serializeLogicalState.ts:223`
- `src/modules/AiRuntime/useCases/llmOrchestration/inference.ts:33,101`
- `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/generateCloudToolCalls.ts:22,61`
- `src/modules/AiRuntime/repositories/webLlm/toolCalling.ts:23`
- `src/modules/AiRuntime/transformers/toolSelector.ts:131,141,153`
- `src/modules/AiRuntime/transformers/promptParser/parsing.ts:86,89,102`
- `src/modules/AiRuntime/services/scaleTheory.ts:94,106`
- `src/modules/AiRuntime/services/fuzzySearch.ts:54,87,101,169`
- `src/modules/AiRuntime/stores/aiActionHistoryStore.ts:45`

**Needed:** Manual rename per file (no automated bulk edits per
project rules). Use the actual domain noun: `track`, `clip`,
`device`, `note`, `action`, `tool`, `message`, `result`. Drop
single-letter names. Do not let the same word (`time`) bind to
five different domain concepts in the same file.

### 17. Type assertion escapes (`as unknown as …`, `as Record<string, unknown>`)

**Problem:** AGENTS.md forbids `as unknown as …` to bypass index
signature variance, and `as Record<string, unknown>` to mutate
typed objects in place.

**Representative files:**

- `src/modules/AiRuntime/repositories/webLlm/engineLifecycle.ts:94` (`created as unknown as WebLlmEngine`)
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:338,349,366,376,386,394,404,414,445` (in-place DSO mutation via `as Record<string, unknown>`)
- `src/modules/AiRuntime/useCases/dsoEditor/serializeLogicalState.ts:141,155` (`(clip as Record<string, unknown>).gain` / `.name`)
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:216,229` (`as Record<string, unknown>`)
- `src/modules/AiRuntime/useCases/aiPanelActions/runAppAction.ts:9` (`as Promise<void>`)

**Needed:** Type the source structurally. For DSOs in
`compileDso.resolveDsoNames`, pass each DSO through a typed mapper
that produces a new typed instance instead of in-place mutation.
For `WebLlmEngine`, derive the type structurally from
`@mlc-ai/web-llm`. For `serializeLogicalState`, fix the underlying
clip/device types in `Arrangement` to expose `gain`/`name` as
typed optional fields.

### 18. I/O-boundary `as` casts without runtime validation

**Problem:** Tauri / WebLLM / Anthropic / fetch responses are cast
to typed shapes. AGENTS.md "Prefer ... runtime validation at I/O
boundaries (e.g. Zod)".

**Representative files:**

- `src/modules/AiRuntime/repositories/nativeEngine/streaming.ts:98` (`JSON.parse(jsonStr) as { choices: … }`)
- `src/modules/AiRuntime/repositories/nativeEngine/completions.ts:21,43`
- `src/modules/AiRuntime/repositories/webLlm/engineLifecycle.ts:156-158`
- `src/modules/AiRuntime/useCases/llmOrchestration/inference.ts:42-44`
- `src/modules/AiRuntime/useCases/sendChatMessage.ts:255,260`
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:358,381`

**Needed:** Add Zod (or hand-rolled) schemas for each external
shape. Validate at the boundary; surface a diagnostic on shape
drift instead of crashing in the consumer.

### 19. `aiPanelActions/{runAppAction,toggleChat,undoLastAction}` are no-op pass-throughs

**Problem:** Each is a 3–10 line forwarder to a different module's
use case. Adds a directory's worth of indirection with no value
(no validation, no store mutation, no logging). Same anti-pattern
as the `audioAi/*.ts` issue called out in the AudioAnalysis audit.

**Representative files:**

- `src/modules/AiRuntime/useCases/aiPanelActions/runAppAction.ts`
- `src/modules/AiRuntime/useCases/aiPanelActions/toggleChat.ts`
- `src/modules/AiRuntime/useCases/aiPanelActions/undoLastAction.ts`

**Needed:** Either inline the calls at the consumer (chat panel
button, action history panel) or assign each a real responsibility
(undo telemetry, action grouping, error mapping). If the wrappers
exist solely to expose `Command`/`Workspace` use cases as
`AiRuntime` use cases, ditch the indirection — let the consumer
import from the owning module.

### 20. `aiHistoryActions.ts` filename violates one-function-per-file naming

**Problem:** `aiHistoryActions.ts` exports a single function
`revertAiActionGroup`. AGENTS.md "One Function Per File" is
satisfied; the file naming is the legacy plural.

**Representative files:**

- `src/modules/AiRuntime/useCases/aiHistoryActions.ts`

**Needed:** Rename to `revertAiActionGroup.ts`. Update the import
in `useCases/index.ts` (currently uses `from './aiHistoryActions'`
nowhere — this file isn't re-exported, so the rename is internal-
only).

### 21. `KNOWN_ACTION_TYPES_MAP` and `PAYLOAD_VALIDATORS` are duplicated lists

**Problem:** Both `validateActions.ts:12-241` and
`validateActionPayload.ts:71-404` exhaust `RuntimeActionType` in
parallel. Adding a new action requires updating two `satisfies`-
checked maps. Drift is caught by the compiler, but the duplication
is a maintenance tax.

**Representative files:**

- `src/modules/AiRuntime/useCases/validateActions.ts:12-241`
- `src/modules/AiRuntime/useCases/validateActionPayload.ts:71-404`

**Needed:** Combine into a single
`Record<RuntimeActionType, PayloadValidator<…> | 'unchecked'>` —
the value tells you both "type is known" and "validator (if any)".
`KNOWN_ACTION_TYPES.has(type)` becomes
`type in PAYLOAD_VALIDATORS`.

### 22. `getProjectContext` returns mutable cached objects shared across callers

**Problem:** Module-level cache holds a `ProjectContext`. Two
callers receive the same reference. If one mutates (sorting
`tracks`, etc.), the next observes the mutation.

**Representative files:**

- `src/modules/AiRuntime/useCases/getProjectContext.ts:52-129`

**Needed:** Either type the return as `Readonly<ProjectContext>`
(deep readonly) or `structuredClone` the cached value before
returning. The cache is a memoization detail; consumers should not
rely on identity.

### 23. `extractThinkBlock` regex runs per-token over an O(n²) accumulating string

**Problem:** Streaming chat updates run the regex on the full
accumulated content per token. For a 2 048-token stream, that is
~2M regex invocations on growing strings. Quadratic.

**Representative files:**

- `src/modules/AiRuntime/useCases/sendChatMessage.ts:30-49,228,242,267-272`

**Needed:** Track the `<think>` open/close index manually as
tokens arrive. Skip the closing-tag scan if no closing tag has
been seen. Or run `extractThinkBlock` only at end-of-stream and
pass through the running string verbatim during streaming.

### 24. `add_midi_notes` / `set_time_signature` / `duplicate_clip` DSOs bypass the AppAction pipeline

**Problem:** Several DSO ops mutate stores directly instead of
dispatching `AppAction`s. They miss `PAYLOAD_VALIDATORS`, do not
appear in the per-action history, and only get undo coverage
through the DSO snapshot.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:721-734` (`duplicate_clip` calls `addClip` directly)
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:780-792` (`set_time_signature` writes `transportStore` directly)
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:821-849` (`add_midi_notes` writes `midiStore` directly)

**Needed:** Route every DSO through `executeAppAction` with the
appropriate `AppAction` shape. If a corresponding action does not
exist (e.g. a multi-note batch addition), add it. Validate the
payload via the standard pipeline.

### 25. `initEngine` race + WebLLM/cloud fallback hole

**Problem:** Two concurrent `initEngine` calls both proceed past
the (non-existent) coalescing guard.
`initWebLlmEngine` coalesces, but `initNativeEngine` does not.
Additionally, the native-fail → WebLLM fallback runs only if
WebGPU is present; if WebGPU is present **and** WebLLM init
throws, the cloud fallback at `initEngine.ts:45-49` is unreachable
because it sits inside the same `else if` chain.

**Representative files:**

- `src/modules/AiRuntime/useCases/llmOrchestration/lifecycle/initEngine.ts:25-65`
- `src/modules/AiRuntime/repositories/nativeEngine/lifecycle.ts:30-91`

**Needed:** Coalesce concurrent `initEngine` calls via a
Promise singleton (same pattern as `engineLifecycle.ts:52-54`).
Restructure the fallback chain so each fallback is independently
available: try native → if fail, try WebLLM if WebGPU available
→ if fail or WebGPU unavailable, try cloud if configured →
otherwise error. Add a test for the failure-cascade.

### 26. `tryPresetMatch` always returns `confidence: 0.95` regardless of fuzzy score

**Problem:** Hard-coded confidence ignores the actual match score
returned by `findBestMatch`. Consumers that branch on
`result.confidence` (none today, but the field is part of
`IntentResult`) get a misleading number.

**Representative files:**

- `src/modules/AiRuntime/useCases/parsePromptToActions.ts:41,53,65`
- `src/modules/AiRuntime/services/fuzzySearch.ts:62-73`

**Needed:** Either drop the `confidence` field from `IntentResult`
or compute it from the actual fuzzy score (e.g. `match.score /
200`).

### 27. `_jsonEditApplied` / `_jsonEditAttempted` underscore-marker fields

**Problem:** `IntentResult` carries `_jsonEdit*` fields that
encode "this branch took the DSO path". Underscore-prefixed
fields are a private-marker convention that has no enforcement in
TypeScript — they are public on the type. The intent ("transient
out-of-band signalling") is better expressed as a discriminated
union.

**Representative files:**

- `src/modules/AiRuntime/models/IntentResult.ts`
- `src/modules/AiRuntime/useCases/parsePromptToActions.ts:91-101,109-115`
- `src/modules/AiRuntime/useCases/sendChatMessage.ts:134-138,139-153`

**Needed:** Replace with a discriminated union:
`type IntentResult = { kind: 'fastPath'; actions: RuntimeAction[];
… } | { kind: 'dsoApplied'; summaries: string[] } | { kind:
'dsoAttempted' } | { kind: 'noMatch' }`. Drop the `confidence`
field if the consumer no longer needs it.

### 28. `cloudAuth.client` lifecycle: in-flight requests not aborted on key clear

**Problem:** `clearCloudApiKey` sets `client = null` but does not
abort in-flight `client.messages.stream(...)` calls. A request
launched just before the user clears the key will still complete.

**Representative files:**

- `src/modules/AiRuntime/repositories/cloudLlm/keyManagement.ts:32-35`
- `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/streamCloudChatCompletion.ts:23-34`

**Needed:** Track in-flight stream controllers and call `abort()`
on `clearCloudApiKey`. Or thread an `AbortSignal` through every
call site.

### 29. Cloud streaming uses `client.messages.stream` without an `AbortSignal`

**Problem:** `streamCloudChatCompletion` accepts no `signal`
parameter. The user-facing stop button (`stopGenerating`) only
aborts via the `activeAborter` controller in `chatStore`, which
the cloud stream does not consume. Cloud generations cannot be
cancelled mid-flight from the UI.

**Representative files:**

- `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/streamCloudChatCompletion.ts:5-35`

**Needed:** Accept an optional `signal: AbortSignal` parameter and
pass it to `client.messages.stream`. Wire `chatStore.activeAborter`
into the call.

### 30. Native completions / dev-mode SSE swallow malformed chunks

**Problem:** Empty `catch {}` blocks around `JSON.parse` of SSE
data drops tokens silently when the model emits malformed chunks.

**Representative files:**

- `src/modules/AiRuntime/repositories/nativeEngine/streaming.ts:97-105`
- `src/modules/AiRuntime/repositories/nativeEngine/completions.ts` (no equivalent — non-streaming)

**Needed:** Log malformed chunks at `logger.debug` level so
diagnostics are available without being noisy. Track a
`malformedChunkCount` per stream and surface it if it crosses a
threshold (suggests model corruption).

### 31. `executeDsos` provides no `AbortSignal`

**Problem:** A DSO plan with 30 ops cannot be cancelled. The user
is locked out of new chat sends until the plan completes.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:943-957`
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:91-187`

**Needed:** Plumb `aborter.signal` through `executeDsoEdit` →
`executeDsos` → each `executeSingleDso`. Check between ops; reject
the promise on abort. Surface the partial state ("aborted after 5
of 12 changes").

### 32. `aria-live` missing on chat / mix-analysis output

**Problem:** Streaming assistant content lands in plain divs.
Screen readers receive no announcement.

**Representative files:**

- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`
- `src/modules/AiRuntime/presentations/components/AiTaskResultCard.tsx`
- `src/modules/AiRuntime/presentations/views/MixAnalysisPanel.tsx` (suspected; not read in this audit)

**Needed:** Wrap the streaming output container in
`role="status" aria-live="polite" aria-atomic="false"`. For
errors, use `role="alert"`. For long generations, announce
"Thinking…" / "Generating…" / "Done" at progress checkpoints.

### 33. `compileDso.ts:232` Levenshtein is O(n*m) per name comparison and runs against every track/clip/device

**Problem:** `bestMatch` calls `levenshtein` on every `(query,
candidate)` pair when the candidate length is ≤20 and the query
≤15. For a project with 200 tracks/clips/devices the resolution
scans all of them — O(N · ~200) per name lookup. Multiply by the
number of name fields per DSO (`track_id`, `clip_id`,
`device_id`, `from_track_id`, `to_track_id`,
`destination_track_id`) and a 30-DSO plan, you have ~36 000
levenshtein calls. The DP table allocates `Array.from({ length:
m+1 }, …)` per call (`compileDso.ts:235`).

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:232-273`

**Needed:** (a) Pre-bin candidates by first letter or length to
prune the search. (b) Reuse a single `Float32Array` /
`Uint16Array` DP buffer across calls. (c) Move the resolver into
a service file (`services/nameResolution.ts`) and unit-test it.

### 34. Hand-rolled `SpeechRecognitionInstance` type drifts from DOM lib

**Problem:** `useVoiceRecording.ts:24-34` defines a partial
`SpeechRecognitionInstance` type. Any new fields the DOM API
exposes (or any breaking-change in `webkitSpeechRecognition`) are
invisible.

**Representative files:**

- `src/modules/AiRuntime/presentations/hooks/useVoiceRecording.ts:24-43`

**Needed:** If the project's `lib` includes `dom.iterable`, use
the DOM `SpeechRecognition` and `SpeechRecognitionEvent` types
directly. Otherwise move the hand-rolled type into
`models/WebSpeechApi.ts` with a comment naming the spec source.

### 35. `mcpToolAdapter/` may have dead pass-throughs

**Problem:** The folder has `mcpToOpenAiTools.ts`,
`mcpToCompactPromptText.ts`, `helpers.ts`. Only
`mcpToOpenAiTools` is imported by
`generateCloudToolCalls.ts:5`. Need to verify the others are
not orphaned.

**Representative files:**

- `src/modules/AiRuntime/repositories/mcpToolAdapter/mcpToCompactPromptText.ts`
- `src/modules/AiRuntime/repositories/mcpToolAdapter/helpers.ts`

**Needed:** Run `grep -r "mcpToCompactPromptText\|from
'.*mcpToolAdapter/helpers'" src/`. If unused, surface in a
follow-up cleanup task. (Do not delete without explicit
instruction per project rules.)

### 36. `executeDsoEdit` hard-codes `'qwen3-8b'` as the model id on completion

**Problem:** `finish()` sets `llmStatusStore.set({ state: 'ready',
modelId: 'qwen3-8b' })` regardless of the actual backend or
loaded model.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:191-194`

**Needed:** Resolve the active model id at completion time —
`getActiveModelId()` for WebLLM, a backend-specific accessor for
native, `CLOUD_MODEL` for cloud (note: cloud is documented as
not used for DSO planning, but the safety belt should still hold).

### 37. `engineLifecycle.ts:100-104` floats an unhandled rejection

**Problem:** `engineState.initPromise.catch(...)` runs as a side
effect. If the caller does not also `.catch`, the rejection is
unhandled. Better: `await` inside an async IIFE so the catch path
runs in the same control flow.

**Representative files:**

- `src/modules/AiRuntime/repositories/webLlm/engineLifecycle.ts:65-107`

**Needed:** Refactor to a single async-IIFE that catches inline,
sets `state: 'error'`, resets the holder, and rethrows. Callers
get one rejection path.

### 38. `unloadWebLlmEngine` does not reset `activeModelId`

**Problem:** After unload, `activeModelId` still names the
previously-loaded model. `initWebLlmEngine` then uses that as
the default `targetModel` if no `modelId` is passed.

**Representative files:**

- `src/modules/AiRuntime/repositories/webLlm/engineLifecycle.ts:110-121`

**Needed:** Reset `activeModelId` to `DEFAULT_WEBLLM_MODEL_ID` on
unload, or explicitly require `modelId` on the next init.

### 39. `coerceToolCall` silently mixes `arguments` / `parameters`

**Problem:** `(obj.arguments ?? obj.parameters ?? {})` masks
provider-format differences. A model emitting Anthropic-style
`{name, input}` silently degrades to `arguments: {}`.

**Representative files:**

- `src/modules/AiRuntime/transformers/toolCallParser.ts:111`

**Needed:** Detect the provider format upstream and route to a
format-specific coercer. Or accept multiple shapes explicitly:
`obj.arguments ?? obj.parameters ?? obj.input ?? null` and reject
when null.

### 40. `react-markdown` rendering of streamed content is not sanitised

**Problem:** `ChatPanel.tsx` renders assistant messages via
`react-markdown` with `remark-gfm`. Markdown can include images,
links, raw HTML (if the parser is configured to allow it). LLM
output is not sanitised. Verify `react-markdown` defaults to
disallowed-HTML, but image URLs that exfiltrate via referer or
remote-loaded SVGs are still possible.

**Representative files:**

- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx:13-14`

**Needed:** Configure `react-markdown` with a strict
allowed-tags/attributes list (`disallowedElements: ['script',
'iframe', 'object', 'embed']`, `allowElement` filter, no images
from arbitrary domains). Add a snapshot test for a malicious
sample markdown payload.

### 41. Native completions / DSO planning JSON parsing has a regex catastrophic-backtrack risk

**Problem:** `executeDsoEdit.parseEditPlan` uses a greedy regex
`/\{[\s\S]*"kind"\s*:\s*"edit_plan"[\s\S]*\}/` on potentially
large model outputs. On a malformed response with many `{`s and
no matching closing `}`, the regex engine backtracks heavily.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:226`

**Needed:** Replace the salvage regex with a streaming
brace-balanced parser. Or cap the search window to N kB.

### 42. `presentations/components/AiTaskResultCard.tsx` mutates AiGeneration state directly

**Problem:** Imports `removeTask` from `#/modules/AiGeneration/useCases`
and calls it from `onClick`. Allowed by AGENTS.md (cross-module
barrel), but the card lives in `AiRuntime/presentations/`. The
ownership is split: AiRuntime renders the card, AiGeneration
manages the state.

**Representative files:**

- `src/modules/AiRuntime/presentations/components/AiTaskResultCard.tsx:7,45`

**Needed:** Decide which module owns the AI task lifecycle. If
AiGeneration owns it, move the card there and re-export the
view. If AiRuntime owns the user-facing AI feedback (toasts,
results), define a wrapping use case in
`AiRuntime/useCases/aiTaskActions/removeTask.ts` that delegates.

---

## Open questions

- [ ] Is the missing root `index.ts` deliberate (some modules in
      this repo also lack it, treating each barrel as an independent
      surface)? Or is it an oversight? Confirm against AGENTS.md
      and other module audits.
- [ ] What is the trust contract for `restoreDsoSnapshot`? The DSO
      bundle is binary Automerge state — is it safe to assume the
      LLM never produces it (only the system does, via
      `transactSnapshot`)? If yes, why is it in `RuntimeAction`
      at all (it's not user-issuable). If no, it needs payload
      validation.
- [ ] Should `compileDso.resolveDsoNames` ever auto-create a
      track? If yes, only for `add_*` ops. If no, every miss is
      a `DsoValidationError`.
- [ ] Is `mixHealthAnalysis` cloud-only intentionally (the LLM
      requires high-quality output that local models can't
      provide)? If yes, document and fall back gracefully when no
      cloud key. If no, route through `resolveBackend`.
- [ ] What is the cancellation contract for cloud / native /
      WebLLM streams? Today only WebLLM is plumbed via
      `aborter.signal.aborted` checks (sendChatMessage), and even
      that is best-effort.
- [ ] Are the underscore-prefixed `_jsonEdit*` fields part of a
      public contract or transient signalling? Affects whether
      they get migrated to a discriminated union (#27) or stay.

---

## Risks

- **Hallucinated destructive actions reach handlers unvalidated.**
  Issue #2: `restoreDsoSnapshot`, `removeAllTracks`, `loadPreset`,
  `exportDawProject`, all `generate*`, etc. carry the comment
  "trusted: handler validates" with no enforcement. An LLM
  hallucinating `restoreDsoSnapshot` with a malformed bundle
  reaches the snapshot restore path. Worst case: project state
  corruption.
- **DSO auto-create on remove-fails.** Issue #3: user requests
  "delete Bass", system creates a Bass track. Subtle UX bug that
  trains the LLM (via the recent-edits log) on its own mistakes.
- **Mix-health prompt sends literal backslash-n.** Issue #4: a
  ship-grade feature emits broken markdown to the LLM. Output
  quality is whatever Claude does with a single 4 kB line.
- **Concurrency-induced state corruption.** Issues #8, #11, #25:
  `activeAborter` overwrite, native engine double-init, init/abort
  races. The chat panel "Stop" button can abort the wrong stream;
  two model loads can race on the Tauri side.
- **Silent-default audio output.** Issue #9: hallucinated style /
  scale / key names default to safe-but-wrong values
  (`'major'`/`'pop'`/`'rock'`/C). The user gets a generic-sounding
  result and no warning that the request was misinterpreted. The
  session log records the wrong intent, which feeds the next
  prompt's context.
- **Type-soundness erosion.** Issues #13, #15, #17, #18: `as
unknown as`, `as Record<string, unknown>`, `as Promise<void>`,
  hand-rolled `Extract2`, type-guard returns discarded into
  `boolean`. The static type system is being routed around at
  every boundary; refactors that should produce compile errors
  produce nothing.
- **Architectural drift.** Issues #1, #19, #20, #21, #42: no root
  barrel, no-op pass-through use cases, dual exhaustive maps for
  the same union, presentation components mutating other modules'
  state. AGENTS.md "Index exports" and "One Function Per File"
  are obeyed cosmetically; the spirit (curated cross-module surface,
  one logical unit per file) is not.
- **Accessibility.** Issue #32: no `aria-live` on streaming
  output. Screen-reader users get no signal that the assistant is
  responding. Combined with the no-progress-feedback issue, AI
  features are functionally unusable with assistive tech.

---

## Suggested approaches

- **Land `validateActionPayload` hardening first** (issue #2). The
  `'unchecked'` sentinel is a known security gap; collapse it to
  `'validatedByHandler' | PayloadValidator<…>` and audit every
  destructive action's handler-side validation. Add a regression
  test feeding malformed payloads through every destructive
  action.
- **Fix `mixHealthAnalysis` and `compileDso.resolveDsoNames`
  in a single short-PR** (issues #3, #4). Both are surgical and
  high-impact. Two failing tests first (expected newlines in the
  prompt; expected `DsoValidationError` for missing-track
  remove), then the fix.
- **Introduce a root `index.ts`** (issue #1) and migrate external
  consumers in lockstep. `pnpm deps:validate` after each batch.
- **Add a Zod (or hand-rolled exhaustive) schema for `EditPlan`**
  (issue #5) and run it before any DSO touches the resolver. This
  catches issue #6 (empty wrapper trust), #14 (toolCall name
  trust), and the underlying cause of issue #9 (unknown enum
  fallthrough — the schema rejects unknowns).
- **Sweep the bizarre callback names** (issue #16) one file at a
  time. Manual edits per project rules. This is mechanical but
  tedious — pair it with the "fix DI `any` leak" pass (#7) so
  the type-flow improves alongside readability.
- **Promise-coalesce `initEngine`** (issue #25). One pattern,
  reused from `engineLifecycle.ts:52-54`.
- **Plumb `AbortSignal` end-to-end** (issues #28, #29, #31).
  Cloud `client.messages.stream` accepts `signal`; native /
  WebLLM streams already check `aborter.signal.aborted` in some
  paths but not all.
- **Combine the dual exhaustive maps** (issue #21) and decide on
  the discriminated-union for `IntentResult` (#27) in the same
  refactor pass.
- **Audit `mcpToolAdapter/` for dead exports** (issue #35) before
  the next architecture sweep so the cleanup is part of the
  AGENTS.md compliance pass.

---

## Recommendation

Start with **issue #2 (validateActionPayload hardening)**. The
trust gap is the most serious and the fix is deterministic. Add a
property test that fuzzes payload shapes against
`PAYLOAD_VALIDATORS` and asserts that any payload not matching the
typed shape is rejected for destructive actions. Land the test
first, then collapse the `'unchecked'` sentinel for the
destructive subset, then expand to the rest as a follow-up.

After that, **issue #4 (`mixHealthAnalysis` `\n` bug)** because it
is a one-character fix with a tangible UX win, and **issue #3 (DSO
auto-create on remove-fail)** because it can be addressed without
touching anything else and removes a worst-case UX trap.

Then split the remaining work along two tracks:

- **Trust track**: #5 (EditPlan schema), #6 (mixHealth backend),
  #9 (silent enum defaults), #14 (toolCall trust), #28/#29/#31
  (cancellation), #40 (markdown sanitisation).
- **Architecture track**: #1 (root barrel), #16 (callback naming),
  #17/#18 (type assertions), #19/#20/#21 (no-op pass-throughs and
  duplication), #15 (`React.memo`), #32 (`aria-live`).

The two tracks are independent.

---

## Resolved

_No issues resolved yet._
