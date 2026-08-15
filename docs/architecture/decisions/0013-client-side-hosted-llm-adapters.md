# ADR 0013: Client-side hosted LLM adapters

- Status: Accepted
- Date: 2026-07-27
- Amended by: ADR 0035 for remote HTTPS OpenAI-compatible transport; loopback development remains browser-side.
- Amended by: ADR 0036 for the provider-neutral ordered and bounded stream envelope.

## Context

Sourdaw currently constructs one Anthropic client directly in the browser. The agentic command boundary must also support OpenAI and arbitrary OpenAI-compatible providers while preserving WebLLM and native-local inference. A Sourdaw AI/provider server is explicitly out of scope for this phase.

Provider APIs differ in authentication, message streaming, and tool-call response shapes. Those differences must terminate inside repositories; use cases and the LLM action bridge must remain provider-neutral.

Browser-held API keys are inherently less protected than server-held credentials. This phase is intended for local bring-your-own-key testing and must not silently turn volatile credentials into durable application state.

## Decision

The volatile hosted-LLM session owns one discriminated provider runtime:

- `anthropic`: Anthropic Messages API through repository-owned transports: the official SDK for structured tool planning, and authenticated fetch/SSE with explicit request, response, event, and cancellation bounds for chat streaming.
- `openai`: OpenAI Chat Completions through the official HTTPS endpoint.
- `openai-compatible`: a user-supplied Chat Completions base URL and model.

Hosted adapters implement the same two capabilities: structured tool planning and chat text streaming. Provider-specific request and response formats do not escape the repository layer.

Configuration follows these rules:

1. API keys, provider runtime objects, and active request controllers remain in memory only.
2. Reconfiguration or removal aborts every active hosted request before replacing credentials.
3. Keys are never logged or included in application errors.
4. Model identifiers remain user-configurable rather than being treated as permanent constants.
5. Custom base URLs require HTTPS, except loopback HTTP endpoints used for local development.
6. Browser CORS or provider-policy failures are surfaced as failures; the app does not bypass browser security controls.
7. Credential drafts are cleared when their provider or compatible endpoint changes, preventing a key from being sent to a different destination.
8. UI consumers observe one AiRuntime-owned, non-secret provider-status projection; credentials and provider client objects never enter that store.
9. Users can explicitly select native-local, WebLLM, or hosted execution. Explicit selection is exclusive and never silently falls through to another provider; automatic mode prefers an already-running backend before applying the normal local-first fallback order.
10. Anthropic and OpenAI require credentials. OpenAI-compatible endpoints may be auth-free; in that case no `Authorization` header is sent.
11. Tool planning rejects token-limited, refused, malformed, or otherwise incomplete provider envelopes before any proposed call reaches the action bridge.
12. Credential removal or reconfiguration is a terminal cancellation, distinct from user Stop and ordinary provider failure.
13. Stream adapters require the provider protocol's terminal event or finish reason; a transport that ends without one fails instead of being accepted as complete.
14. Every chat consumer receives the terminal outcome. Structured-data consumers reject incomplete output before parsing or mutation; human-readable chat preserves partial text but marks it incomplete.
15. Changing backend preference aborts active generation and backend initialization, releases in-progress WebLLM worker resources, and prevents stale readiness from the previous selection.
16. Hosted credentials are shown as configured, not connected or ready; hosted readiness is established only by a successful provider request, never by configuration alone.
17. Unavailable explicit selections report the missing capability or configuration instead of a generic GPU failure.
18. UI surfaces own an abort signal for every hosted request and abort it on close or replacement so stale tokens cannot update a later run.
19. Every native inference request carries a request ID. Abort and timeout dispatch a native cancellation command; Rust races that request-scoped token against model generation, drops the model response channel, and the frontend detaches its channel callback.
20. Cancelled edit planning terminalizes its assistant message and restores the prior ready status only when it remains compatible with the selected backend.
21. Native structured inference rejects malformed tool arguments, unexpected stream EOF, inconsistent tool-call finish reasons, and token-limited terminal reasons. Pre-registration cancellation tombstones are time-limited and bounded.
22. Native model initialization is single-flight in Rust. Each initialization request owns the model it installs, and cancellation cleanup may unload only that request's model, never a replacement initialization's model.
23. WebLLM initialization is attempt-owned. Only a live same-model attempt may be coalesced; superseded attempts cannot clear or overwrite a replacement attempt's worker, promise, engine, model, or status.
24. Coalesced WebLLM callers own independent waits; one caller's abort cancels the shared initialization only when no live caller remains. Native readiness is published only after Rust confirms that a loaded model was finalized.

The OpenAI-compatible adapter uses the widely implemented `/chat/completions` tool-calling contract in this phase. Provider-specific APIs such as OpenAI Responses may be admitted later behind the same repository capability boundary.

## Consequences

- Anthropic, OpenAI, and compatible local/hosted gateways share one command path.
- No server, credential persistence, or provider-specific project mutation path is introduced.
- Some providers or gateways will not be browser-callable until they explicitly allow the app origin.
- A future server can replace credential transport without changing action validation or DAW execution.
