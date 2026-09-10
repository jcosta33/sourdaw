import { describe, expect, it } from 'vitest';

import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { type ToolCallResult } from '../../transformers/toolCallParser';

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

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
];

export type ProviderStreamScenario =
    'text-deltas' | 'final-usage' | 'unknown-event' | 'refusal' | 'truncation' | 'cut-stream' | 'malformed-event';

export type ProviderToolScenario = 'tool-batch' | 'empty-batch' | 'malformed-arguments';

/** What the adapter put on the wire, read back from the transport the harness stubbed. */
export type ProviderRequestObservation = { model: unknown; stream: unknown };

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
};

export type ProviderProtocolHarness = {
    streamText: (scenario: ProviderStreamScenario) => Promise<ProviderStreamObservation>;
    planTools: (scenario: ProviderToolScenario) => Promise<ProviderToolObservation>;
};

function expectStreamRequest(request: ProviderRequestObservation): void {
    expect(request.model).toBe(PROVIDER_CONFORMANCE_FIXTURE.model);
    expect(request.stream).toBe(true);
}

function expectToolRequest(request: ProviderRequestObservation): void {
    expect(request.model).toBe(PROVIDER_CONFORMANCE_FIXTURE.model);
    expect(request.stream).not.toBe(true);
}

function expectNoProviderBodyText(safeMessage: string | undefined): void {
    expect(safeMessage ?? '').not.toBe('');
    expect(safeMessage).not.toContain(PROVIDER_CONFORMANCE_FIXTURE.providerBodyText);
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
    });
}
