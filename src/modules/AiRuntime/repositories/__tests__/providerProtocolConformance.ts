import { describe, expect, it } from 'vitest';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { type HostedToolPlanUsage } from '../cloudLlm/cloudInference/hostedToolPlan';

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

const BOUND_KEYWORDS = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'maxItems',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when a wire property schema admits `null` through either mechanism the OpenAI
 * strict projection uses: a widened `type` array, or an `anyOf` branch typed `null`
 * (the shape `makeNullable` builds for a property whose own schema was not a plain
 * `type`, e.g. `enum`).
 */
function isNullableWireSchema(schema: unknown): boolean {
    if (!isRecord(schema)) {
        return false;
    }
    if (Array.isArray(schema.type)) {
        return schema.type.includes('null');
    }
    if (Array.isArray(schema.anyOf)) {
        return schema.anyOf.some((branch) => isRecord(branch) && branch.type === 'null');
    }
    return false;
}

/**
 * Recursively collects every occurrence of a stripped bound keyword still present as a
 * schema node's own keyword. Schema-structure-aware rather than a blind key walk, matching
 * the walker in `anthropicStrictSchemaProjection.spec.ts`/`openAiStrictSchemaProjection.spec.ts`:
 * only `properties`, `items`, and the composition keywords carry nested schema nodes, so a
 * tool argument named e.g. "pattern" is never mistaken for the JSON Schema keyword.
 */
export function findBoundKeywords(node: unknown, found: string[] = []): string[] {
    if (Array.isArray(node)) {
        for (const entry of node) {
            findBoundKeywords(entry, found);
        }
        return found;
    }
    if (typeof node !== 'object' || node === null) {
        return found;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if ((BOUND_KEYWORDS as readonly string[]).includes(key)) {
            found.push(key);
            continue;
        }
        if (key === 'properties' && typeof value === 'object' && value !== null) {
            for (const propertySchema of Object.values(value as Record<string, unknown>)) {
                findBoundKeywords(propertySchema, found);
            }
            continue;
        }
        if (key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
            findBoundKeywords(value, found);
        }
    }
    return found;
}

/**
 * One logical exchange every hosted protocol must reproduce. Each contract spec
 * renders these values into its own wire format, so a value the suite fails to
 * observe names the adapter that dropped it rather than the fixture.
 */
export const PROVIDER_CONFORMANCE_FIXTURE = {
    model: 'conformance-model-v1',
    providerRequestId: 'provider-request-9f27',
    textDeltas: ['Lower ', 'the vocals'],
    usage: { inputTokens: 11, outputTokens: 4 },
    // Base fields every dialect reports for a tool-planning call; a provider-specific
    // cache-write figure (Anthropic only) is asserted by that provider's own contract
    // spec, not by this shared harness.
    toolUsage: { inputTokens: 21, outputTokens: 6, cacheReadInputTokens: 3 },
    unknownEventType: 'future_event',
    providerBodyText: 'provider-body-text-that-must-not-escape',
    toolCalls: [
        { id: 'call-alpha', wireName: 'project_query', name: 'project.query', arguments: {} },
        {
            id: 'call-beta',
            wireName: 'muteTrack',
            name: 'muteTrack',
            arguments: { trackId: 'track-1', muted: true },
        },
    ],
    malformedArgumentsCallId: 'call-broken',
    oversizedProviderId: 'x'.repeat(5000),
} as const;

export const PROVIDER_CONFORMANCE_TOOL_SCHEMAS: readonly ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'project.query',
            description: 'Read the current project',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'muteTrack',
            description: 'Mute a track',
            parameters: {
                type: 'object',
                properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } },
                required: ['trackId', 'muted'],
                additionalProperties: false,
            },
        },
    },
    // Carries a bound keyword (min/max) and an optional property so the shared
    // 'tool-batch' assertion below exercises both strict-schema behaviours every
    // hosted dialect must reproduce: bounds move off the wire, and an optional
    // property is admitted through whichever mechanism the dialect uses (left out
    // of `required` for Anthropic, made required-and-nullable for OpenAI dialects).
    {
        type: 'function',
        function: {
            name: 'setTempo',
            description: 'Set tempo',
            parameters: {
                type: 'object',
                properties: {
                    bpm: { type: 'number', minimum: 20, maximum: 300, description: 'Beats per minute.' },
                    label: { type: 'string' },
                },
                required: ['bpm'],
                additionalProperties: false,
            },
        },
    },
];

export type ProviderStreamScenario =
    | 'text-deltas'
    | 'final-usage'
    | 'unknown-event'
    | 'refusal'
    | 'truncation'
    | 'cut-stream'
    | 'malformed-event'
    | 'oversized-request-id';

export type ProviderToolScenario =
    | 'tool-batch'
    | 'empty-batch'
    | 'malformed-arguments'
    | 'oversized-call-id'
    | 'forced-terminal'
    | 'two-turn-history'
    | 'foreign-turn-history'
    | 'unidentified-turn-history'
    | 'synthesised-call-id-history'
    | 'multi-call-turn-history';

/** The receipt the earlier turn earned, answered natively as that dialect's tool result. */
export const PROVIDER_TURN_HISTORY_RECEIPT: ApplicationToolReceipt = {
    schema: 'sourdaw.application-tool-receipt',
    schemaVersion: 1,
    callId: 'call-alpha',
    toolName: 'project.query',
    turn: 1,
    status: 'success',
    revision: 'revision-2',
    data: { items: [] },
    summary: 'Queried the project.',
    warnings: [],
    error: null,
};

/**
 * The earlier turn every dialect replays in the two history scenarios. Each contract spec
 * renders `assistantMarker` into its own dialect's turn-one assistant items and tags the
 * foreign record's items with `foreignMarker`, so the shared assertions below can tell a
 * verbatim replay from a synthesised one without knowing the dialect's wire shape.
 */
export const PROVIDER_TURN_HISTORY_FIXTURE = {
    assistantMarker: 'turn-one-assistant-item-marker',
    foreignMarker: 'foreign-dialect-item-marker',
    budgetNote: 'Remaining budget: 2 turn(s), 6 tool call(s), 40000 receipt byte(s).',
    receipt: PROVIDER_TURN_HISTORY_RECEIPT,
} as const;

/**
 * The identifier the loop resolves for a provider call that carried none, in the
 * `<loopId>-<turn>-<index>` form the loop synthesises. Every dialect must put it on the wire
 * unchanged, or the receipt answering that call names an identifier no call carries.
 */
export const SYNTHESISED_TURN_CALL_ID = 'loop-1-1-0';

/** The same earlier turn, earned by a call the provider never named. */
export const PROVIDER_SYNTHESISED_TURN_RECEIPT: ApplicationToolReceipt = {
    ...PROVIDER_TURN_HISTORY_RECEIPT,
    callId: SYNTHESISED_TURN_CALL_ID,
};

/**
 * The identifiers the loop resolves for a turn that carried two calls, both unnamed by the
 * provider: the same `<loopId>-<turn>-<index>` form, one per index. A dialect that restates or
 * answers only the first call leaves the second identifier on one side of the pairing alone.
 */
export const MULTI_CALL_TURN_CALL_IDS = ['loop-1-1-0', 'loop-1-1-1'] as const;

/** Both receipts that turn earned, distinct so a receipt answering the wrong call is visible. */
export const PROVIDER_MULTI_CALL_TURN_RECEIPTS: readonly ApplicationToolReceipt[] = [
    { ...PROVIDER_TURN_HISTORY_RECEIPT, callId: MULTI_CALL_TURN_CALL_IDS[0] },
    {
        ...PROVIDER_TURN_HISTORY_RECEIPT,
        callId: MULTI_CALL_TURN_CALL_IDS[1],
        toolName: 'muteTrack',
        data: { muted: true },
        summary: 'Muted the track.',
    },
];

/** The two tool names every contract spec's `forced-terminal` scenario forces, matching the
 * fixture's own `toolCalls` so the same response body admits under a required directive. */
export const FORCED_TERMINAL_TOOL_NAMES = ['project.query', 'muteTrack'] as const;

/** What the adapter put on the wire, read back from the transport the harness stubbed. The
 * conversation is `messages` or `input`, whichever the dialect names it. */
export type ProviderRequestObservation = {
    model: unknown;
    stream: unknown;
    tools: unknown;
    toolChoice?: unknown;
    messages?: unknown;
    input?: unknown;
};

export type ProviderStreamObservation = {
    text: string;
    usageEvents: ModelProviderUsageEvent[];
    unknownEvents: string[];
    finish: 'stop' | 'length' | 'refusal' | 'error';
    failure?: { safeMessage: string };
    providerRequestId: string | null;
    request: ProviderRequestObservation;
};

export type ProviderToolObservation = {
    calls: ToolCallResult[];
    providerRequestId: string | null;
    failure?: { safeMessage: string };
    request: ProviderRequestObservation;
    usage: HostedToolPlanUsage | null;
};

/** The strict flag and JSON-Schema parameters read off one raw wire tool object, in whichever
 * shape that dialect carries them (Anthropic: `input_schema`; OpenAI dialects: `parameters` or
 * `function.parameters`). Lets the shared assertions below walk the schema without knowing the
 * dialect's own wire shape. */
export type ProviderWireTool = { strict: unknown; parameters: unknown };

/**
 * The identifiers the replayed conversation correlates by, read out of one dialect's own wire
 * shape: the ids the restated tool calls carry (Anthropic `tool_use.id`, Responses
 * `function_call.call_id`, chat completions `tool_calls[].id`) and the ids the tool results
 * answer them with (`tool_result.tool_use_id`, `function_call_output.call_id`,
 * `tool_call_id`), each in wire order.
 */
export type ProviderCorrelationObservation = { callIds: string[]; resultIds: string[] };

export type ProviderProtocolHarness = {
    streamText: (scenario: ProviderStreamScenario) => Promise<ProviderStreamObservation>;
    planTools: (scenario: ProviderToolScenario) => Promise<ProviderToolObservation>;
    readWireTool: (tool: unknown) => ProviderWireTool;
    readCorrelatingIds: (request: ProviderRequestObservation) => ProviderCorrelationObservation;
};

function expectStreamRequest(request: ProviderRequestObservation): void {
    expect(request.model).toBe(PROVIDER_CONFORMANCE_FIXTURE.model);
    expect(request.stream).toBe(true);
}

function expectToolRequest(request: ProviderRequestObservation): void {
    expect(request.model).toBe(PROVIDER_CONFORMANCE_FIXTURE.model);
    expect(request.stream).not.toBe(true);
}

/** The conversation the adapter sent, serialized so a shared assertion can read it without
 * knowing whether the dialect carries items as `messages` or as `input`. */
function readConversation(request: ProviderRequestObservation): string {
    const conversation = request.messages ?? request.input;
    expect(conversation).not.toBeUndefined();
    return JSON.stringify(conversation);
}

function expectNoProviderBodyText(safeMessage: string | undefined): void {
    expect(safeMessage ?? '').not.toBe('');
    expect(safeMessage).not.toContain(PROVIDER_CONFORMANCE_FIXTURE.providerBodyText);
}

// Mirrors the reader's own opaque-token bound: a message leaking even one
// window this wide of a rejected body-scale id is leaking response body.
const PROVIDER_ID_WINDOW_LENGTH = 64;

function containsWindowOf(haystack: string, source: string, windowLength: number): boolean {
    for (let index = 0; index + windowLength <= source.length; index += 1) {
        if (haystack.includes(source.slice(index, index + windowLength))) {
            return true;
        }
    }
    return false;
}

/**
 * The behaviour a hosted adapter owes its callers, stated once and run against every
 * protocol. A scenario that passes for one provider and fails for another is the
 * divergence this suite exists to surface.
 */
export function describeProviderProtocolConformance(name: string, harness: ProviderProtocolHarness): void {
    describe(`${name} protocol conformance`, () => {
        it('concatenates text deltas in the order the provider streamed them', async () => {
            const observed = await harness.streamText('text-deltas');

            expect(observed.text).toBe(PROVIDER_CONFORMANCE_FIXTURE.textDeltas.join(''));
            expect(observed.finish).toBe('stop');
            expect(observed.providerRequestId).toBe(PROVIDER_CONFORMANCE_FIXTURE.providerRequestId);
            expectStreamRequest(observed.request);
        });

        it('reports one provider-reported final usage event', async () => {
            const observed = await harness.streamText('final-usage');

            const finalUsage = observed.usageEvents.filter((event) => event.mode === 'final');
            expect(finalUsage).toHaveLength(1);
            expect(finalUsage[0]).toMatchObject({
                type: 'usage',
                provenance: 'provider-reported',
                usage: {
                    inputTokens: PROVIDER_CONFORMANCE_FIXTURE.usage.inputTokens,
                    outputTokens: PROVIDER_CONFORMANCE_FIXTURE.usage.outputTokens,
                },
            });
            expect(observed.finish).toBe('stop');
            expectStreamRequest(observed.request);
        });

        it('surfaces an unknown provider event by name and keeps streaming', async () => {
            const observed = await harness.streamText('unknown-event');

            expect(observed.unknownEvents).toHaveLength(1);
            const [namespace, eventType] = (observed.unknownEvents[0] ?? '').split(':');
            expect(namespace).toBeTruthy();
            expect(eventType).toBe(PROVIDER_CONFORMANCE_FIXTURE.unknownEventType);
            expect(observed.text).toBe(PROVIDER_CONFORMANCE_FIXTURE.textDeltas.join(''));
            expect(observed.finish).toBe('stop');
            expectStreamRequest(observed.request);
        });

        it('finishes a refusal without exposing the provider refusal text', async () => {
            const observed = await harness.streamText('refusal');

            expect(observed.finish).toBe('refusal');
            expectNoProviderBodyText(observed.failure?.safeMessage);
            expect(observed.text).not.toContain(PROVIDER_CONFORMANCE_FIXTURE.providerBodyText);
            expectStreamRequest(observed.request);
        });

        it('finishes a max-token truncation as length and keeps the partial output', async () => {
            const observed = await harness.streamText('truncation');

            expect(observed.finish).toBe('length');
            expect(observed.text).toBe(PROVIDER_CONFORMANCE_FIXTURE.textDeltas[0]);
            expectStreamRequest(observed.request);
        });

        it('finishes a stream cut before its terminal marker as an error', async () => {
            const observed = await harness.streamText('cut-stream');

            expect(observed.finish).toBe('error');
            expectNoProviderBodyText(observed.failure?.safeMessage);
            expect(observed.text).toBe(PROVIDER_CONFORMANCE_FIXTURE.textDeltas[0]);
            expectStreamRequest(observed.request);
        });

        it('finishes a malformed stream event as an error without echoing its data line', async () => {
            const observed = await harness.streamText('malformed-event');

            expect(observed.finish).toBe('error');
            expectNoProviderBodyText(observed.failure?.safeMessage);
            expectStreamRequest(observed.request);
        });

        it('keeps every tool-call id, decodes dotted wire names, and preserves batch order', async () => {
            const observed = await harness.planTools('tool-batch');

            expect(observed.calls).toEqual(
                PROVIDER_CONFORMANCE_FIXTURE.toolCalls.map((call) => ({
                    id: call.id,
                    name: call.name,
                    arguments: call.arguments,
                }))
            );
            expect(observed.providerRequestId).toBe(PROVIDER_CONFORMANCE_FIXTURE.providerRequestId);
            expectToolRequest(observed.request);

            expect(Array.isArray(observed.request.tools)).toBe(true);
            const tools = observed.request.tools as unknown[];
            expect(tools.length).toBeGreaterThan(0);
            let checkedOptionalProperty = false;
            for (const tool of tools) {
                const { strict, parameters } = harness.readWireTool(tool);
                expect(strict).toBe(true);
                expect(findBoundKeywords(parameters)).toEqual([]);

                // `setTempo` carries `label`, the fixture's one optional property, so its
                // wire shape exercises the dialect's own optional-property mechanism: left
                // out of `required` for Anthropic, or forced into `required` and made
                // nullable for the OpenAI dialects. Read from the wire tool itself rather
                // than branching on the dialect's name, so the assertion holds regardless
                // of which harness supplies it.
                const properties = isRecord(parameters) ? parameters.properties : undefined;
                if (!isRecord(properties) || !('label' in properties)) {
                    continue;
                }
                checkedOptionalProperty = true;
                const propertyKeys = Object.keys(properties);
                const required = isRecord(parameters) && Array.isArray(parameters.required) ? parameters.required : [];
                if (required.includes('label')) {
                    expect(new Set(required)).toEqual(new Set(propertyKeys));
                    expect(isNullableWireSchema(properties.label)).toBe(true);
                } else {
                    expect(required).not.toContain('label');
                }
            }
            expect(checkedOptionalProperty).toBe(true);
            expect(observed.usage).toMatchObject({
                inputTokens: PROVIDER_CONFORMANCE_FIXTURE.toolUsage.inputTokens,
                outputTokens: PROVIDER_CONFORMANCE_FIXTURE.toolUsage.outputTokens,
                cacheReadInputTokens: PROVIDER_CONFORMANCE_FIXTURE.toolUsage.cacheReadInputTokens,
            });
        });

        it('accepts an empty tool-call batch as no calls', async () => {
            const observed = await harness.planTools('empty-batch');

            expect(observed.calls).toEqual([]);
            expect(observed.failure).toBeUndefined();
            expectToolRequest(observed.request);
        });

        it('rejects malformed tool-call arguments with an error naming the call id', async () => {
            const observed = await harness.planTools('malformed-arguments');

            expect(observed.calls).toEqual([]);
            expect(observed.failure?.safeMessage).toContain(PROVIDER_CONFORMANCE_FIXTURE.malformedArgumentsCallId);
            expectNoProviderBodyText(observed.failure?.safeMessage);
            expectToolRequest(observed.request);
        });

        it('rejects a malformed tool call carrying a body-scale id without leaking it', async () => {
            const observed = await harness.planTools('oversized-call-id');

            expect(observed.calls).toEqual([]);
            expectNoProviderBodyText(observed.failure?.safeMessage);
            const safeMessage = observed.failure?.safeMessage ?? '';
            expect(safeMessage).not.toContain(PROVIDER_CONFORMANCE_FIXTURE.oversizedProviderId);
            expect(
                containsWindowOf(
                    safeMessage,
                    PROVIDER_CONFORMANCE_FIXTURE.oversizedProviderId,
                    PROVIDER_ID_WINDOW_LENGTH
                )
            ).toBe(false);
            expectToolRequest(observed.request);
        });

        it('discards an oversized body-scale request id instead of admitting it', async () => {
            const observed = await harness.streamText('oversized-request-id');

            expect(observed.providerRequestId).toBeNull();
            expect(observed.finish).toBe('stop');
            expectStreamRequest(observed.request);
        });

        it('replays the earlier turn natively and closes the conversation with the budget note', async () => {
            const observed = await harness.planTools('two-turn-history');

            expect(observed.calls).toEqual(
                PROVIDER_CONFORMANCE_FIXTURE.toolCalls.map((call) => ({
                    id: call.id,
                    name: call.name,
                    arguments: call.arguments,
                }))
            );
            const conversation = readConversation(observed.request);
            // The provider's own items from turn one, the receipt that answered them, and the
            // remaining-budget note that closes them — never the receipts folded into a prompt.
            expect(conversation).toContain(PROVIDER_TURN_HISTORY_FIXTURE.assistantMarker);
            expect(conversation).toContain(PROVIDER_TURN_HISTORY_FIXTURE.receipt.callId);
            expect(conversation).toContain(PROVIDER_TURN_HISTORY_FIXTURE.receipt.summary);
            expect(conversation).toContain(PROVIDER_TURN_HISTORY_FIXTURE.budgetNote);
            expectToolRequest(observed.request);
        });

        it('restates a turn another dialect answered as tool calls instead of replaying its items', async () => {
            const observed = await harness.planTools('foreign-turn-history');

            const conversation = readConversation(observed.request);
            expect(conversation).not.toContain(PROVIDER_TURN_HISTORY_FIXTURE.foreignMarker);
            expect(conversation).toContain(PROVIDER_TURN_HISTORY_FIXTURE.receipt.callId);
            expect(conversation).toContain(PROVIDER_TURN_HISTORY_FIXTURE.budgetNote);
            expectToolRequest(observed.request);
        });

        it('restates a call the provider never named under the identifier its receipt carries', async () => {
            const observed = await harness.planTools('synthesised-call-id-history');

            const correlation = harness.readCorrelatingIds(observed.request);
            expect(correlation.callIds).toEqual([SYNTHESISED_TURN_CALL_ID]);
            expect(correlation.resultIds).toEqual([SYNTHESISED_TURN_CALL_ID]);
            expectToolRequest(observed.request);
        });

        it('restates its own turn from the recorded calls when that turn carries no replayable items', async () => {
            const observed = await harness.planTools('unidentified-turn-history');

            // Same dialect, but the turn left a call unnamed: its items name an identifier the
            // receipt cannot answer, so the calls are restated under the loop's identifier and
            // the tool results still correlate to them.
            const correlation = harness.readCorrelatingIds(observed.request);
            expect(correlation.callIds).toEqual([SYNTHESISED_TURN_CALL_ID]);
            expect(correlation.resultIds).toEqual([SYNTHESISED_TURN_CALL_ID]);
            const conversation = readConversation(observed.request);
            expect(conversation).not.toContain(PROVIDER_TURN_HISTORY_FIXTURE.assistantMarker);
            expect(conversation).toContain(PROVIDER_TURN_HISTORY_FIXTURE.budgetNote);
            expectToolRequest(observed.request);
        });

        it('restates every call of a multi-call turn and answers each with its own receipt', async () => {
            const observed = await harness.planTools('multi-call-turn-history');

            // Both calls and both receipts, in the order the turn recorded them: a dialect that
            // stops after the first leaves the second call unanswered or its receipt orphaned.
            const correlation = harness.readCorrelatingIds(observed.request);
            expect(correlation.callIds).toEqual([...MULTI_CALL_TURN_CALL_IDS]);
            expect(correlation.resultIds).toEqual([...MULTI_CALL_TURN_CALL_IDS]);
            expectToolRequest(observed.request);
        });

        it('forces the terminal tool choice on the wire and still admits the reply', async () => {
            const observed = await harness.planTools('forced-terminal');

            expect(observed.calls).toEqual(
                PROVIDER_CONFORMANCE_FIXTURE.toolCalls.map((call) => ({
                    id: call.id,
                    name: call.name,
                    arguments: call.arguments,
                }))
            );
            expectToolRequest(observed.request);
            expect(observed.request.toolChoice).not.toBeUndefined();
            expect(observed.request.toolChoice).not.toBe('auto');
        });
    });
}
