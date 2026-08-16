# ADR 0037: Retire native Mistral inference

- Status: Accepted
- Supersedes: the native-local portions of ADR 0013 and ADR 0036

## Context

The desktop shell previously owned a local model lifecycle, inference commands, cancellation, generated ACL, and a renderer adapter. That duplicate execution surface increased packaging and platform risk without changing the validated AI action boundary.

## Decision

Sourdaw supports browser WebLLM and configured hosted Anthropic, OpenAI, and OpenAI-compatible providers. The Tauri shell does not load, manage, or execute a local language model, and it exposes no language-model command or permission.

Saved backend preferences outside the supported set normalize to automatic mode during preference writes. Automatic mode prefers available WebLLM and can use a configured hosted provider; an explicit supported selection remains fail-closed.

Provider protocol, data-policy disclosure, token budgets, cancellation, and AgentRun evidence remain provider-neutral. AI-proposed changes continue through the validated command and confirmation boundary; retiring one inference placement does not create a new write path.

## Consequences

The application no longer ships local-model assets, model lifecycle controls, native inference dependencies, or native inference ACL. Browser-local and hosted operation remain independently selectable and observable.
