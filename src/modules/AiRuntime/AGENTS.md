# AiRuntime module — Agent Guidelines

LLM orchestration, provider routing (WebLLM vs hosted cloud), prompt planning into executable DAW action graphs, agent saga lifecycles, and voice input routing; does not own audio DSP, local neural model artifact storage (BrowserAi), or pattern generation algorithms (AiGeneration).

## Public Contract Surface

- `useCases`:
    - **Provider & Model Routing**: `resolveBackend`, `isLlmAvailable`, `setAiBackendPreference`, `getActiveModelId`, `WEBLLM_MODELS`, `isComplexPrompt`, `configureCloudProvider`, `getConfiguredCloudProvider`, `removeCloudProvider`, `isCloudAvailable`, `streamHostedModelText`, `streamCloudChatCompletion`, `generateWebLlmCompletion`, `initEngine`, `unloadEngine`.
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

## Verification

```bash
pnpm vitest run src/modules/AiRuntime
```
