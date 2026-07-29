# ADR 0018: Awaited AI action admission

**Status:** Accepted

## Context

AI actions must report whether project control actually completed. Six existing application handlers start asynchronous work without returning its promise: `saveProject`, `newProject`, `exportProject`, `importAudioFile`, `importMidiFile`, and `leaveCollabSession`. Admitting them would let the AI execution boundary report success before the operation completes or fails.

The prompt parser also currently conflates recognized-but-rejected commands with an unrecognized prompt. That can hide validation or provider-bridge rejection behind a no-match fallback, and it can incorrectly continue into the legacy DSO path after the strict bridge has rejected a provider plan.

Removing unsafe presets from the executable registry must not make their established phrases look unrecognized. Provider refusal or malformed/incomplete tool planning is also a terminal rejection, not evidence that the user intended the legacy DSO language.

## Decision

- AI runtime validation denies the six proven fire-and-forget action types before payload validation.
- Fast-path presets stop advertising those denied actions, while a separate non-executable recognizer retains their deterministic phrases without constructing actions.
- A recognized fast-path batch is admitted as a whole or rejected as a whole when validation filters any action.
- Provider-bridge, provider-batch validation, refusal, and malformed or incomplete planning failures return a human-readable rejection reason and never fall through to DSO parsing.
- DSO fallback is available only after provider tool planning completes successfully with zero proposed calls.
- Prompt execution renders recognized rejection as an error receipt distinct from a no-match response and executes no action.
- Configuration-change and genuinely unrecognized prompt behavior remain unchanged.

## Consequences

AI receipts remain truthful: an accepted action is awaitable through the command boundary, while a recognized but unsafe or invalid command is explicitly refused without project mutation. The denied operations remain available through their existing non-AI application surfaces until their handlers return completion-aware promises and can be safely reconsidered for AI admission.
