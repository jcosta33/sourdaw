# Standing probes: provider request content

Defects where a model-provider request or an exported AI diagnostics record carries a credential, unaccounted
usage, or internal values the provider's question does not need, or where a byte crosses the gateway after
cancellation or a cap. Trace each serialized body and record to every source field: a parser accepting a shape
proves the shape, not that every field is necessary or safe to send. Compose credential fixtures at runtime; offline
captures through the real repository and gateway ports prove admission and serialization, not remote egress.
Revert only the production hunk on a committed head and require the same caller oracles to fail without changing
specs.

## Standing probes

1. **The provider credential stays out of every renderer surface (#4159, #4175).** The credential crosses the
   renderer exactly once, on `open_provider_gateway_session`, and every later surface (stores, diagnostics,
   errors, IPC payloads) must lack it, including a base64 or hex copy and a UTF-8 byte view nested in a plain
   object. Run `pnpm guard --profile focused -- pnpm test:run src/modules/AiRuntime/repositories/__tests__/providerSecretBoundary.spec.ts`
   after copying the credential into one store field or a gateway request body: the recursive content walk must
   fail by value, not by key name. An oversize credential, a base URL embedding credentials, and an authenticated
   HTTPS openai-compatible endpoint refuse before any desktop-bridge call or store write.
2. **Diagnostics redaction pairs each label with its whole value (#4307).** `redactSecrets` in
   `src/modules/AiRuntime/services/agentRunRedaction/redactSecrets.ts` runs labelled forms before the encoded-run
   pattern, so one credential is replaced once and counted once. Feed `Bearer` and `Basic` header values, a quoted
   JSON key with a JSON-escaped quote inside its value, a double-quoted value carrying a single quote and the
   reverse, an unterminated quoted value, a query string with parameters after the secret, a label an underscore
   precedes, and an already redacted `[redacted]` placeholder; keep a `inputTokens` count field and ordinary
   project text unchanged as controls. Reordering the patterns, or dropping escaped-character consumption from the
   quoted entries, must fail `src/modules/AiRuntime/useCases/__tests__/agentRunLogRedaction.spec.ts`. The screen
   covers named shapes only; a redacted record never states that it holds no secret.
3. **Gateway cancellation and caps hold at every boundary.** `runProviderGatewayRequest` in
   `src/modules/AiRuntime/repositories/providerGateway.ts` checks the request body cap in UTF-8 bytes before any
   channel exists, and refuses cross-request, out-of-order, post-completion and over-count events. Abort before
   channel creation, after it, during the invoke and after a body chunk: no chunk reaches the caller after abort and
   exactly one cancel invoke is sent. A multibyte body one byte over the cap must refuse where a UTF-16 length check
   would admit it. A missing terminal event refuses. Dropping the post-invoke abort check, or measuring
   `body.length`, must fail `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/__tests__/requestOpenAiProvider.spec.ts`
   or the probe's added case. A byte cap never establishes a token or cost cap.
4. **Usage aggregation checks the sum, not the parts (#4451).** Each counter can be a safe integer while their sum
   is not. Drive `accumulateAnthropicInputUsage` with raw, cache-read and cache-write counters whose individual
   values are safe and whose total exceeds `Number.MAX_SAFE_INTEGER`: the input total must report unavailable
   counters, never a rounded number. A total exactly at the limit stays available. Removing the
   `Number.isSafeInteger(totalInputTokens)` term must fail
   `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/__tests__/generateAnthropicToolCalls.spec.ts`.
5. **Billed usage survives rejected, partial and cached responses (#4393, #2648, #4407).** Use unequal raw,
   cache-read and cache-write counts and assert the provider's documented inclusive total and separate counters
   through the real producer, the protocol accumulator in `src/modules/AiRuntime/useCases/modelProviderProtocol.ts`
   and run accounting; a terminal output-only stream event must not add the input counters twice. Report each
   required counter as null in turn: the usage stays incomplete with that counter named as unavailable, and every
   cost surface distinguishes an incomplete report from a final provider total. Stub an OpenAI-compatible 200 with
   two choices and inclusive usage 63/9 through the real adapter, inference and run accounting: one 72-token cost
   carrying the original attempt, provider and model, a typed retryable failure and zero executable tool calls.
   Dropping usage on the rejection path must fail
   `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/__tests__/generateOpenAiCompatibleToolCalls.spec.ts`.
6. **Internal level fields reach the provider wire (#4392).** Assertions on producer objects or a master/track-only
   projection miss what the provider receives. Inspect `buildAgentContext().message` in full and delta modes,
   change an unselected track's clip, send and gain lane independently of its gain and name, and require every
   linear value beside its decibel reading, removals represented, and exactly one law header. Dropping the law
   header from a delta must fail `src/modules/AiRuntime/__tests__/projectContextLevelUnits.spec.ts`.

## Relocated

- The review-record publication screen for credential-shaped values (`scripts/evidenceSafety.ts`, which replaced
  the deleted stance-check request builder) is a publication contract, not provider egress; its probes live with
  the record that publishes it → `public-repair-records.md` probe 12.
