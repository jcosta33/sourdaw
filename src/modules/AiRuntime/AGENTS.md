# AiRuntime module — Agent Guidelines

LLM orchestration, provider routing (WebLLM vs hosted cloud), prompt planning into executable DAW action graphs, agent saga lifecycles, and voice input routing; does not own audio DSP, local neural model artifact storage (BrowserAi), or pattern generation algorithms (AiGeneration).

## Public Contract Surface

- `useCases`:
    - **Provider & Model Routing**: `resolveBackend`, `isLlmAvailable`, `setAiBackendPreference`, `getActiveModelId`, `WEBLLM_MODELS`, `listHostedAnthropicModels`, `getDefaultHostedAnthropicModel`, `isComplexPrompt`, `configureCloudProvider`, `getConfiguredCloudProvider`, `removeCloudProvider`, `isCloudAvailable`, `streamHostedModelText`, `streamCloudChatCompletion`, `generateWebLlmCompletion`, `initEngine`, `unloadEngine`.
    - **Prompt Planning & Dispatch**: `parsePromptToActions`, `planPromptActions`, `executePlannedActions`, `executePromptActionGroup`, `compilePlannedActionCommandBatch`, `searchPresets`, `getAvailablePresets`, `resolvePresetActions`, `generateToolCalls`, `getMidiNoteGenerationToolSchemas`, `requireMidiNoteGenerationToolCall`, `injectPromptCommand`, `onPromptInjection`, `runAiActionWithToast`, `notifyAiChange`, `describePlannedAction`.
    - **Agent Saga & Execution**: `getAgentExecutionModeAuthority`, `resolveAgentExecutionMode`, `issueAgentCommandApprovalBinding`, `agentRunCancellation`, `agentRunLifecycle`, `recoverInterruptedAgentRuns`, `agentRunWorkLease`, `normalizeAgentFailure`, `admitAgentRetry`, `admitBoundedAgentCorrection`, `createAgentSagaStep`, `agentRunControls`, `deleteAgentRunArtifacts`, `getAgentRunSagaProjection`.
    - **Voice & Mix Analysis**: `isVoiceInputAvailable`, `initializeVoiceInputAvailability`, `toggleVoiceInput`, `setVoiceToggleEventBus`, `injectVoicePromptDraft`, `onVoicePromptDraft`, `createVoicePromptDraftAdmission`, `mixHealthAnalysis`, `beginMixAnalysis`, `completeMixAnalysis`, `failMixAnalysis`, `getAiOrganizationHandlers`, `getProjectContext`, `getAiRuntimeProtocolContracts`.
- `stores`: `aiActionHistoryStore`, `aiBackendPreferenceStore`, `llmStatusStore`, `hostedLlmProviderStatusStore`, `voiceStatusStore`, `voiceInputAvailabilityStore`.
- `presentations/views`: `AiActionHistoryPanel`, `AiChangeToast`, `ChatPanel`, `GenerativeAiPanel`, `MixAnalysisPanel`, `VoiceCommandOverlay`.
- Handlers: `getAiOrganizationHandlers`.

## Key Subsystems

- **LLM Provider Routing**: Selects between in-browser WebLLM (WebGPU-backed) and hosted cloud providers, handling streaming token generation and schema-constrained tool-calling.
- **Action Planning Kernel**: Decomposes natural language requests into typed `ActionCommandGraph` nodes and compiles them into atomic `Command` batches.
- **Agent Saga Engine**: Manages autonomous agent execution runs, approval bindings, interrupted run recovery, and compensation steps.
- **Voice Ingestion**: Routes speech recognition transcripts through draft admission gates before submission to the action planner.

## Invariants & Traps

- AI actions must always compile to versioned `Command` envelopes and execute via `executeAppActionBatch` — direct store mutations from LLM runners bypass undo history and CRDT replication.
- Cloud API keys and authentication tokens are local configuration only and must never be serialized into project documents or synced across collaboration channels.
- Guarded agent execution modes require explicit user approval bindings before high-risk actions (file deletion, track deletion, destructive overwrite) are committed.
- A request that names no object still compiles, through the plan-created object route: grounding admits a call whose whole effect lands inside an object the same batch creates, in place of the prompt-vocabulary evidence such an object can never carry. Membership is by what a command changes, not by what it targets — `PLAN_CREATED_OBJECT_COMMANDS` is stated explicitly for that reason, and a command that merely accepts a batch-local target reaches the surrounding project through it. Creation evidence is read from the user request text alone; feeding project data to that reader lets a stored name buy a waiver the user never asked for.
- Declining is a contract, not a free-text refusal. `clarify` must carry at least one question, and `unsupported` stands only when the run already searched the command index successfully — what the outcome reports is that search, never that the searched intents were related to the request.
- A discovered MIDI transform is a plan item the compiler expands, never a command the runtime executes. It targets one clip — a `$binding` an earlier item produced, or an existing writable MIDI clip — takes no selector and no repeat, and is spliced in place as ordinary `addNotes` commands carrying its own dependencies, so the batch it joins is indistinguishable from one whose notes the provider wrote by hand except in the evidence, which records the transforms expanded. This module owns none of the transform contract and imports no generator ([ADR 0043](../../../.agents/decisions/0043-midi-transforms-compile-to-add-notes-through-the-command-registry.md)).
- Every bound the route relies on is a named constant, never a literal at the check: the clip span and timeline bounds in `SemanticCommandList`, the creation budget applied to both proposal forms, and the note count and minimum duration in `midiNoteBatchLimits` that the provider schema, the bridge, and the materialized-argument validator all read. A bound written twice drifts silently, and the route it drifts out of stops holding.

## Verification

```bash
pnpm vitest run src/modules/AiRuntime
```
