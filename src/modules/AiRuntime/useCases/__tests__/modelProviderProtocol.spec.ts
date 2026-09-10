import { describe, expect, it } from 'vitest';

import { REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type ModelProviderFinish,
    type ModelProviderPartialOutputDisposition,
    type ModelProviderResult,
} from '../../models/ModelProviderProtocol';
import { remoteTransmissionDisclosure } from '../discloseRemoteTransmission';

import { createRequest, eventEnvelope, finishEnvelope, readyRequest } from './modelProviderProtocolFixture';

type FinishTableRow = {
    name: string;
    pushOutput: boolean;
    exceedsBudget?: boolean;
    finish: ModelProviderFinish;
    expected: {
        status: ModelProviderResult['status'];
        code: string | null;
        retryable: boolean | null;
        disposition: ModelProviderPartialOutputDisposition;
    };
};

const FINISH_TABLE: FinishTableRow[] = [
    {
        name: 'cancelled with output preserves the partial output',
        pushOutput: true,
        finish: { reason: 'cancelled' },
        expected: { status: 'cancelled', code: 'cancelled', retryable: true, disposition: 'preserve' },
    },
    {
        name: 'cancelled with no output discards it',
        pushOutput: false,
        finish: { reason: 'cancelled' },
        expected: { status: 'cancelled', code: 'cancelled', retryable: true, disposition: 'discard' },
    },
    {
        name: 'length with output marks the response partial',
        pushOutput: true,
        finish: { reason: 'length' },
        expected: { status: 'partial', code: 'output-limit', retryable: true, disposition: 'preserve' },
    },
    {
        name: 'length with no output marks the response failed',
        pushOutput: false,
        finish: { reason: 'length' },
        expected: { status: 'failed', code: 'output-limit', retryable: true, disposition: 'discard' },
    },
    {
        name: 'a retryable provider error preserves partial output',
        pushOutput: true,
        finish: {
            reason: 'error',
            failure: { code: 'provider-5xx', retryable: true, safeMessage: 'The provider returned a 5xx error.' },
        },
        expected: { status: 'partial', code: 'provider-5xx', retryable: true, disposition: 'preserve' },
    },
    {
        name: 'a non-retryable refusal discards empty output',
        pushOutput: false,
        finish: {
            reason: 'refusal',
            failure: { code: 'refused', retryable: false, safeMessage: 'The provider refused the request.' },
        },
        expected: { status: 'failed', code: 'refused', retryable: false, disposition: 'discard' },
    },
    {
        name: 'a stop that exceeds the admitted budget is exhausted and non-retryable',
        pushOutput: true,
        exceedsBudget: true,
        finish: { reason: 'stop' },
        expected: { status: 'partial', code: 'budget-exhausted', retryable: false, disposition: 'preserve' },
    },
    {
        name: 'a stop within budget completes with no failure',
        pushOutput: true,
        finish: { reason: 'stop' },
        expected: { status: 'complete', code: null, retryable: null, disposition: 'none' },
    },
];

const RESULT_KEYS = [
    'schemaVersion',
    'provider',
    'model',
    'correlationId',
    'status',
    'output',
    'usage',
    'finishReason',
    'partialOutputDisposition',
    'failure',
    'ignoredProviderEvents',
].sort();

describe('model provider protocol', () => {
    it('accumulates delta usage counters until a terminal outcome and reports the last provenance', () => {
        const { protocol, request } = readyRequest();
        const session = protocol.start(request);

        session.push(
            eventEnvelope(request, 0, {
                type: 'usage',
                mode: 'delta',
                usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            })
        );
        session.push(
            eventEnvelope(request, 1, {
                type: 'usage',
                mode: 'delta',
                usage: { inputTokens: null, outputTokens: 7, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'versioned-estimate',
            })
        );
        const result = session.finish(finishEnvelope(request, 2, { reason: 'stop' }));

        expect(result.usage).toEqual({
            inputTokens: 10,
            outputTokens: 12,
            cachedInputTokens: null,
            reasoningTokens: null,
            provenance: 'versioned-estimate',
        });
    });

    it('replaces on a cumulative snapshot and folds the terminal final reading without double counting', () => {
        const { protocol: intermediateProtocol, request: intermediateRequest } = readyRequest();
        const intermediateSession = intermediateProtocol.start(intermediateRequest);
        intermediateSession.push(
            eventEnvelope(intermediateRequest, 0, {
                type: 'usage',
                mode: 'delta',
                usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            })
        );
        intermediateSession.push(
            eventEnvelope(intermediateRequest, 1, {
                type: 'usage',
                mode: 'cumulative-snapshot',
                usage: { inputTokens: 30, outputTokens: null, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            })
        );
        const intermediateResult = intermediateSession.finish(
            finishEnvelope(intermediateRequest, 2, { reason: 'cancelled' })
        );
        expect(intermediateResult.usage).toMatchObject({ inputTokens: 30, outputTokens: 5 });

        const { protocol, request } = readyRequest();
        const session = protocol.start(request);
        session.push(
            eventEnvelope(request, 0, {
                type: 'usage',
                mode: 'delta',
                usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            })
        );
        session.push(
            eventEnvelope(request, 1, {
                type: 'usage',
                mode: 'cumulative-snapshot',
                usage: { inputTokens: 30, outputTokens: null, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            })
        );
        session.push(
            eventEnvelope(request, 2, {
                type: 'usage',
                mode: 'final',
                usage: { inputTokens: 31, outputTokens: 12, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            })
        );
        const result = session.finish(finishEnvelope(request, 3, { reason: 'stop' }));

        expect(result.usage).toEqual({
            inputTokens: 31,
            outputTokens: 12,
            cachedInputTokens: null,
            reasoningTokens: null,
            provenance: 'provider-reported',
        });
    });

    it('reports unavailable usage provenance when the provider never emits a usage event', () => {
        const { protocol, request } = readyRequest();
        const session = protocol.start(request);
        const result = session.finish(finishEnvelope(request, 0, { reason: 'stop' }));

        expect(result.usage).toEqual({
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
            provenance: 'unavailable',
        });
    });

    it.each(FINISH_TABLE)('$name', ({ pushOutput, exceedsBudget, finish, expected }) => {
        const { protocol, request } = readyRequest();
        const session = protocol.start(request);
        let sequence = 0;
        if (pushOutput) {
            session.push(eventEnvelope(request, sequence, { type: 'text', mode: 'delta', text: 'partial output' }));
            sequence += 1;
        }
        if (exceedsBudget === true) {
            session.push(
                eventEnvelope(request, sequence, {
                    type: 'usage',
                    mode: 'final',
                    usage: {
                        inputTokens: 0,
                        outputTokens: request.budget.maxOutputTokens + 1,
                        cachedInputTokens: null,
                        reasoningTokens: null,
                    },
                    provenance: 'provider-reported',
                })
            );
            sequence += 1;
        }
        const result = session.finish(finishEnvelope(request, sequence, finish));

        expect(result.status).toBe(expected.status);
        expect(result.failure?.code ?? null).toBe(expected.code);
        expect(result.failure?.retryable ?? null).toBe(expected.retryable);
        expect(result.partialOutputDisposition).toBe(expected.disposition);
        if (result.failure !== null) {
            expect(result.failure.correlationId).toBe(request.correlationId);
        }
    });

    it('retains unknown future provider events by name until the terminal outcome, without throwing', () => {
        const { protocol, request } = readyRequest();
        const session = protocol.start(request);
        const names = ['response.future_thing', 'message_stop', 'response.future_thing'];

        for (const [index, name] of names.entries()) {
            session.push(eventEnvelope(request, index, { type: 'unknown', providerEventType: name }));
        }
        const result = session.finish(finishEnvelope(request, names.length, { reason: 'stop' }));

        expect(result.status).toBe('complete');
        expect(result.ignoredProviderEvents).toEqual(names);
    });

    it('rejects an unavailable modality before admitting the request', () => {
        // Exercises the modality-availability gate in compileRequest so a capabilities change that quietly
        // admits an unsupported modality does not slip past this suite unnoticed.
        const { compiled } = createRequest({ modality: 'audio' });

        expect(compiled).toMatchObject({
            status: 'unavailable',
            failure: {
                code: 'modality-unavailable',
                retryable: false,
                partialOutputDisposition: 'none',
            },
        });
    });

    it.each(['openai', 'openai-compatible'] as const)('admits parallel tool calls for %s', (provider) => {
        const { compiled } = createRequest({
            provider,
            allowParallelToolCalls: true,
            dataPolicy: 'remote-allowed',
            dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES],
            remoteDisclosure: remoteTransmissionDisclosure.issue({
                categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
                correlationId: 'correlation-1',
                requestId: 'request-1',
            }),
        });

        if (compiled.status !== 'ready') {
            throw new Error(compiled.failure.code);
        }
        expect(compiled.request.allowParallelToolCalls).toBe(true);
    });

    it('exposes only the documented result keys and schema version', () => {
        const { protocol, request } = readyRequest();
        const session = protocol.start(request);
        const result = session.finish(finishEnvelope(request, 0, { reason: 'stop' }));

        expect(Object.keys(result).sort()).toEqual(RESULT_KEYS);
        expect(result.schemaVersion).toBe(MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION);

        // createSession's resultForFinish never assigns `remoteDisclosure` on its own result, and
        // createModelProviderStreamWriter returns that result unchanged; only a caller such as
        // streamHostedModelText.ts merges the {requestId, categories, retention} shape in afterward.
        const remoteDisclosure = remoteTransmissionDisclosure.issue({
            categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
            correlationId: 'correlation-1',
            requestId: 'request-1',
        });
        const { protocol: remoteProtocol, compiled: remoteCompiled } = createRequest({
            provider: 'anthropic',
            dataPolicy: 'remote-allowed',
            dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES],
            remoteDisclosure,
        });
        if (remoteCompiled.status !== 'ready') {
            throw new Error(remoteCompiled.failure.safeMessage);
        }
        const remoteResult = remoteProtocol
            .start(remoteCompiled.request)
            .finish(finishEnvelope(remoteCompiled.request, 0, { reason: 'stop' }));

        expect(Object.keys(remoteResult).sort()).toEqual(RESULT_KEYS);
        expect(remoteResult).not.toHaveProperty('remoteDisclosure');
    });
});
