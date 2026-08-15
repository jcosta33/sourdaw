# ADR 0035: Privileged model-provider extensions

- Status: Accepted
- Date: 2026-08-15

## Context

ADR 0013 admitted user-configured OpenAI-compatible HTTPS endpoints through renderer `fetch`. That is sufficient for browser CORS but not for a provider-extension boundary: renderer requests inherit ambient browser networking, cannot pin connection-time DNS admission, and do not prove that credentials and request bodies remain on one approved origin.

Provider-specific request and response formats must still terminate inside AiRuntime repositories. Models may select tools and arguments, but may not supply transport destinations or executable adapter code.

## Decision

Remote HTTPS OpenAI-compatible configurations compile the release-owned `builtin.openai-compatible.chat-completions.v1` adapter. Its immutable contract contains stable adapter, provider, and model IDs; the `openai-chat-completions` protocol family; normalized capabilities; fixed `/v1/models` and `/v1/chat/completions` paths; bounded request/response sizes; cancellation; single-attempt retry policy; and credential, request-body, and provider-error redaction rules.

The adapter uses the Tauri provider gateway. The gateway:

1. accepts only a canonical HTTPS host-and-port origin and a compiled adapter ID;
2. chooses the request path from the compiled adapter and never accepts a model-supplied URL;
3. resolves DNS at connection time, rejects empty, non-global, metadata, or mixed public/private results, and pins the admitted addresses into the HTTP client;
4. disables environment proxies and redirects, so credentials and bodies cannot cross origins;
5. bounds credentials, request bodies, response bodies, pending cancellation state, and request identifiers;
6. streams response bytes over an IPC channel and supports request-scoped cancellation without logging secrets or provider bodies.

Before the first request for one compiled runtime, AiRuntime performs the adapter's fixed capability probe and normalizes it against the configured model. An absent model or malformed probe fails closed.

Explicit loopback HTTP remains the development-only browser adapter admitted by ADR 0013. It is not a provider extension and cannot be selected by model output. Future adapter installation must add a reviewed registry entry on both sides of the Tauri boundary; arbitrary downloaded JavaScript is not an installation mechanism.

## Consequences

- Remote OpenAI-compatible credentials and bodies leave the renderer only through an origin-bound native transport.
- OpenAI-compatible request/event normalization remains in AiRuntime repositories; Rust owns network admission rather than provider semantics.
- Existing loopback development gateways keep their browser behavior.
- Supporting another protocol family requires compiled adapter code, the common conformance suite, and an explicit privileged-gateway endpoint mapping.
