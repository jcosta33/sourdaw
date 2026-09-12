import { describe, expect, it } from 'vitest';

import { eventEnvelope, finishEnvelope, readyRequest } from './modelProviderProtocolFixture';

const MAX_UNKNOWN_EVENTS = 64;

function createRequest() {
    return readyRequest({
        operation: 'tools',
        cancellationGeneration: 3,
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
    });
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

        session.push(eventEnvelope(request, 0, { type: 'text', mode: 'delta', text: 'one' }));

        expect(() =>
            session.push(eventEnvelope(request, 0, { type: 'text', mode: 'delta', text: 'duplicate' }))
        ).toThrow(/sequence/i);
        expect(() =>
            protocol.start(request).push(eventEnvelope(request, 1, { type: 'text', mode: 'delta', text: 'skipped' }))
        ).toThrow(/sequence/i);
        expect(() =>
            protocol.start(request).push(
                eventEnvelope({ ...request, runId: 'run-2' }, 0, {
                    type: 'text',
                    mode: 'delta',
                    text: 'foreign',
                })
            )
        ).toThrow(/run/i);
    });

    it('validates complete declared tool arguments before exposing the call', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);

        expect(() =>
            session.push(
                eventEnvelope(request, 0, {
                    type: 'tool-call',
                    call: { id: 'call-1', name: 'setTempo', arguments: { tempo: 'fast' } },
                })
            )
        ).toThrow(/arguments/i);
        const unadvertisedSession = protocol.start(request);
        expect(() =>
            unadvertisedSession.push(
                eventEnvelope(request, 0, {
                    type: 'tool-call',
                    call: { id: 'call-2', name: 'unadvertisedTool', arguments: {} },
                })
            )
        ).toThrow(/tool/i);
        const validSession = protocol.start(request);
        expect(() =>
            validSession.push(
                eventEnvelope(request, 0, {
                    type: 'tool-call',
                    call: { id: 'call-3', name: 'setTempo', arguments: { tempo: 120 } },
                })
            )
        ).not.toThrow();
        const invalidSchemaSession = protocol.start(request);
        expect(() =>
            invalidSchemaSession.push(
                eventEnvelope(request, 0, {
                    type: 'tool-call',
                    call: { id: 'call-4', name: 'setTempo', arguments: { tempo: 130 } },
                })
            )
        ).toThrow(/arguments/i);
    });

    it('enforces advertised JSON Schema uniqueness before exposing tool arguments', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);

        expect(() =>
            session.push(
                eventEnvelope(request, 0, {
                    type: 'tool-call',
                    call: {
                        id: 'call-unique',
                        name: 'glueClips',
                        arguments: { clipIds: ['clip-1', 'clip-1'] },
                    },
                })
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
                .push(eventEnvelope(request, 0, { type: 'text', mode: 'delta', text: 'x'.repeat(70 * 1_024) }))
        ).toThrow(/payload|size|limit/i);

        const unknownSession = protocol.start(request);
        for (let sequence = 0; sequence < MAX_UNKNOWN_EVENTS; sequence += 1) {
            unknownSession.push(
                eventEnvelope(request, sequence, {
                    type: 'unknown',
                    providerEventType: `future:${String(sequence)}`,
                })
            );
        }
        expect(() =>
            unknownSession.push(
                eventEnvelope(request, MAX_UNKNOWN_EVENTS, { type: 'unknown', providerEventType: 'future:64' })
            )
        ).toThrow(/unknown|limit/i);

        const finishSession = protocol.start(request);
        expect(() =>
            finishSession.finish(
                finishEnvelope(request, 0, {
                    reason: 'error',
                    failure: {
                        code: 'provider-error',
                        retryable: true,
                        safeMessage: 'x'.repeat(70 * 1_024),
                    },
                })
            )
        ).toThrow(/payload|size|limit/i);
        expect(() => finishSession.finish(finishEnvelope(request, 0, { reason: 'stop' }))).not.toThrow();
    });

    it('emits exactly one terminal result and rejects all late or post-cancellation input', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);
        const result = session.finish(finishEnvelope(request, 0, { reason: 'cancelled' }));

        expect(result.status).toBe('cancelled');
        expect(() => session.finish(finishEnvelope(request, 1, { reason: 'stop' }))).toThrow(/terminal|finished/i);
        expect(() => session.push(eventEnvelope(request, 1, { type: 'text', mode: 'delta', text: 'late' }))).toThrow(
            /terminal|finished/i
        );
    });

    it('rejects a stale cancellation generation without changing the accepted output', () => {
        const { protocol, request } = createRequest();
        const session = protocol.start(request);
        session.push(eventEnvelope(request, 0, { type: 'text', mode: 'delta', text: 'accepted' }));

        expect(() =>
            session.push(
                eventEnvelope({ ...request, cancellationGeneration: 2 }, 1, {
                    type: 'text',
                    mode: 'delta',
                    text: 'stale',
                })
            )
        ).toThrow(/generation/i);
    });
});
