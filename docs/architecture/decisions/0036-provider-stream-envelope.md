# ADR 0036: Provider stream envelope

- Status: Accepted
- Date: 2026-08-15

## Context

Sourdaw normalizes native, WebLLM, hosted HTTP, and Tauri provider output into one AiRuntime protocol. The previous protocol described normalized event values but did not bind each event to its agent run, provider request, correlation identifier, sequence position, or cancellation generation. Individual adapters also differed on payload bounds, malformed events, tool-argument validation, and terminal behavior. A late or cross-request event could therefore be accepted as current output, and a provider could consume unbounded renderer memory before the application rejected its result.

## Decision

Model provider protocol version 2 wraps every normalized event and terminal result in an application-owned envelope containing the schema version, run ID, request ID, correlation ID, cancellation generation, and a zero-based contiguous sequence number.

The common protocol and every transport boundary must:

1. reject skipped, duplicate, cross-run, cross-request, stale-generation, and post-terminal events before exposing their payload;
2. bound individual events, accumulated output, retained unknown-event names, request bodies, response bodies, and event counts;
3. tolerate only bounded, correlated unknown event names and never expose their provider payload;
4. validate complete structured output and advertised tool arguments against the application-provided JSON Schema before use;
5. accept exactly one terminal outcome and reject missing, duplicate, or late completion;
6. keep cancellation request-scoped and generation-scoped so an obsolete cancellation cannot affect a replacement request.

Provider-specific wire formats remain repository concerns. A repository stamps validated wire output into the common envelope; it does not move provider parsing into use cases or Rust. Tauri commands additionally include request ID and sequence on every channel event so the renderer can validate the privileged boundary independently.

## Consequences

- Native, WebLLM, hosted, loopback-development, and privileged-gateway streams have the same observable ordering and terminal contract.
- Model provider protocol version 1 stream events are rejected rather than guessed or silently upgraded.
- Supporting a new provider or event family requires explicit bounds, correlation, terminal mapping, and conformance tests at both its wire boundary and the provider-neutral session.
- Unknown future event names can remain diagnosable without granting them payload or state authority.
