import { describe, expect, it } from 'vitest';

import { MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION } from '../../models/ModelProviderProtocol';
import { createModelProviderProtocol } from '../modelProviderProtocol';

const MAX_UNKNOWN_EVENTS = 64;

function createRequest() {
    const protocol = createModelProviderProtocol({ provider: 'webllm', model: 'fixture-model' });
    const compiled = protocol.compileRequest({
        correlationId: 'correlation-1',
        runId: 'run-1',
        requestId: 'request-1',
        cancellationGeneration: 3,
        operation: 'tools',
        modality: 'text',
        messages: [{ role: 'user', content: 'Set the tempo.' }],
        tools: [
            {
                name: 'setTempo',
                description: 'Set the project tempo.',
                parameters: {
                    type: 'object',
                    properties: {
                        tempo: { type: 'number', oneOf: [{ const: 120 }, { const: 140 }] },
                    },
                    required: ['tempo'],
                    additionalProperties: false,
                },
            },
            {
                name: 'glueClips',
                description: 'Glue clips together.',
                parameters: {
                    type: 'object',
                    properties: {
                        clipIds: {
                            type: 'array',
                            items: { type: 'string' },
                            minItems: 2,
                            uniqueItems: true,
                        },
                    },
                    required: ['clipIds'],
                    additionalProperties: false,
                },
            },
        ],
        stream: true,
        limits: { maxOutputTokens: 256 },
        controls: { cache: 'provider-default', reasoning: 'provider-default' },
        budget: { maxInputTokens: 1_024, maxOutputTokens: 256, maxTotalTokens: 1_280 },
        dataPolicy: 'local-only',
    });
    if (compiled.status !== 'ready') {
        throw new Error(compiled.failure.safeMessage);
    }
    return { protocol, request: compiled.request };
}

function eventEnvelope(
    sequence: number,
    event: unknown,
    identity: {
        runId?: string;
        requestId?: string;
        correlationId?: string;
        cancellationGeneration?: number;
    } = {}
) {
    return {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        runId: identity.runId ?? 'run-1',
        requestId: identity.requestId ?? 'request-1',
        correlationId: identity.correlationId ?? 'correlation-1',
        cancellationGeneration: identity.cancellationGeneration ?? 3,
        sequence,
        event,
    };
}

function finishEnvelope(sequence: number, finish: unknown) {
    return {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        runId: 'run-1',
        requestId: 'request-1',
        correlationId: 'correlation-1',
        cancellationGeneration: 3,
        sequence,
        finish,
    };
}

describe('model stream protocol', () => {
    it('binds every compiled request to run, request, correlation, and cancellation generation', () => {
        const { request } = createRequest();

        expect(request).toMatchObject({
            runId: 'run-1',
            requestId: 'request-1',
            correlationId: 'correlation-1',
            cancellationGeneration: 3,
        });
    });

    it('accepts only the next exact envelope and rejects duplicate, skipped, and cross-run events', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);

        session.push(eventEnvelope(0, { type: 'text', mode: 'delta', text: 'one' }) as never);

        expect(() =>
            session.push(eventEnvelope(0, { type: 'text', mode: 'delta', text: 'duplicate' }) as never)
        ).toThrow(/sequence/i);
        expect(() =>
            protocol.start(request).push(eventEnvelope(1, { type: 'text', mode: 'delta', text: 'skipped' }) as never)
        ).toThrow(/sequence/i);
        expect(() =>
            protocol
                .start(request)
                .push(eventEnvelope(0, { type: 'text', mode: 'delta', text: 'foreign' }, { runId: 'run-2' }) as never)
        ).toThrow(/run/i);
    });

    it('validates complete declared tool arguments before exposing the call', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);

        expect(() =>
            session.push(
                eventEnvelope(0, {
                    type: 'tool-call',
                    call: { id: 'call-1', name: 'setTempo', arguments: { tempo: 'fast' } },
                }) as never
            )
        ).toThrow(/arguments/i);
        const unadvertisedSession = protocol.start(request);
        expect(() =>
            unadvertisedSession.push(
                eventEnvelope(0, {
                    type: 'tool-call',
                    call: { id: 'call-2', name: 'unadvertisedTool', arguments: {} },
                }) as never
            )
        ).toThrow(/tool/i);
        const validSession = protocol.start(request);
        expect(() =>
            validSession.push(
                eventEnvelope(0, {
                    type: 'tool-call',
                    call: { id: 'call-3', name: 'setTempo', arguments: { tempo: 120 } },
                }) as never
            )
        ).not.toThrow();
        const invalidSchemaSession = protocol.start(request);
        expect(() =>
            invalidSchemaSession.push(
                eventEnvelope(0, {
                    type: 'tool-call',
                    call: { id: 'call-4', name: 'setTempo', arguments: { tempo: 130 } },
                }) as never
            )
        ).toThrow(/arguments/i);
    });

    it('enforces advertised JSON Schema uniqueness before exposing tool arguments', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);

        expect(() =>
            session.push(
                eventEnvelope(0, {
                    type: 'tool-call',
                    call: {
                        id: 'call-unique',
                        name: 'glueClips',
                        arguments: { clipIds: ['clip-1', 'clip-1'] },
                    },
                }) as never
            )
        ).toThrow(/arguments/i);
    });

    it('bounds individual payloads, accumulated output, and retained unknown events', () => {
        const { protocol, request } = createRequest();

        const oversizedRequest = protocol.compileRequest({
            ...request,
            messages: [{ role: 'user', content: 'x'.repeat(1_024 * 1_024) }],
        });
        expect(oversizedRequest).toMatchObject({ status: 'unavailable', failure: { code: 'invalid-request' } });

        expect(() =>
            protocol
                .start(request)
                .push(eventEnvelope(0, { type: 'text', mode: 'delta', text: 'x'.repeat(70 * 1_024) }) as never)
        ).toThrow(/payload|size|limit/i);

        const unknownSession = protocol.start(request);
        for (let sequence = 0; sequence < MAX_UNKNOWN_EVENTS; sequence += 1) {
            unknownSession.push(
                eventEnvelope(sequence, { type: 'unknown', providerEventType: `future:${String(sequence)}` }) as never
            );
        }
        expect(() =>
            unknownSession.push(
                eventEnvelope(MAX_UNKNOWN_EVENTS, { type: 'unknown', providerEventType: 'future:64' }) as never
            )
        ).toThrow(/unknown|limit/i);

        const finishSession = protocol.start(request);
        expect(() =>
            finishSession.finish(
                finishEnvelope(0, {
                    reason: 'error',
                    failure: {
                        code: 'provider-error',
                        retryable: true,
                        safeMessage: 'x'.repeat(70 * 1_024),
                    },
                }) as never
            )
        ).toThrow(/payload|size|limit/i);
        expect(() => finishSession.finish(finishEnvelope(0, { reason: 'stop' }) as never)).not.toThrow();
    });

    it('emits exactly one terminal result and rejects all late or post-cancellation input', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);
        const result = session.finish(finishEnvelope(0, { reason: 'cancelled' }) as never);

        expect(result.status).toBe('cancelled');
        expect(() => session.finish(finishEnvelope(1, { reason: 'stop' }) as never)).toThrow(/terminal|finished/i);
        expect(() => session.push(eventEnvelope(1, { type: 'text', mode: 'delta', text: 'late' }) as never)).toThrow(
            /terminal|finished/i
        );
    });

    it('rejects a stale cancellation generation without changing the accepted output', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);
        session.push(eventEnvelope(0, { type: 'text', mode: 'delta', text: 'accepted' }) as never);

        expect(() =>
            session.push(
                eventEnvelope(1, { type: 'text', mode: 'delta', text: 'stale' }, { cancellationGeneration: 2 }) as never
            )
        ).toThrow(/generation/i);
    });
});
