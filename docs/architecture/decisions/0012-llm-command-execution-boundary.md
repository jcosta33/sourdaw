# ADR 0012: LLM command execution boundary

- Status: Accepted
- Date: 2026-07-27

## Context

Sourdaw has WebLLM and hosted-model inference adapters, typed DAW tool schemas, prompt-action confirmation, and the `executeAppAction` Automerge write boundary. The provider-neutral tool-calling use case is not connected to prompt execution, so model-produced tool calls do not currently reach that boundary.

Provider output is untrusted. Passing a tool name and arbitrary arguments directly into the complete application action union would expose actions whose payloads or targets are not yet safe for model execution.

## Decision

LLM providers may only propose tool calls. An application-owned bridge converts those calls through an explicit allowlist of closed, runtime-validated actions. Unsupported names, extra fields, invalid bounds, and unavailable project targets are rejected before a proposal is created.

The initial executable path accepts one action per provider plan. Multi-action plans remain unavailable until the command boundary offers atomic batch execution; sequential partial commits are not an acceptable substitute.

Planning and execution remain separate:

1. A provider proposes structured tool calls.
2. The bridge validates and converts them to typed application actions.
3. Existing prompt policy decides whether confirmation is required.
4. Accepted actions execute only through `executeAppAction`.
5. Existing Automerge history and AI action history record the outcome.

Inference placement may vary between WebLLM and admitted hosted-provider adapters. No provider receives a separate mutation path, and no Sourdaw AI/provider server is introduced by this decision.

## Consequences

- The executable LLM surface grows one validated action at a time.
- Multi-action provider plans require a future atomic command primitive before admission.
- Provider-specific response formats terminate at the same bridge.
- Invalid or unsupported tool calls have no project-state effect.
- Existing confirmation, undo, persistence, and collaboration behavior remains authoritative.
