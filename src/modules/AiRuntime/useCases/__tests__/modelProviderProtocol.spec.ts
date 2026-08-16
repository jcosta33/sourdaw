import { describe, expect, it, vi } from 'vitest';

import { REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type ModelProviderEvent,
    type ModelProviderFinish,
    type ModelProviderRequest,
} from '../../models/ModelProviderProtocol';
import { remoteTransmissionDisclosure } from '../discloseRemoteTransmission';
import { getAiRuntimeProtocolContracts } from '../getAiRuntimeProtocolContracts';
import { createModelProviderProtocol } from '../modelProviderProtocol';

function createModelProviderStreamSource(request: ModelProviderRequest) {
    let sequence = 0;
    const identity = {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        runId: request.runId,
        requestId: request.requestId,
        correlationId: request.correlationId,
        cancellationGeneration: request.cancellationGeneration,
    } as const;
    return {
        push(event: ModelProviderEvent) {
            const envelope = { ...identity, sequence, event };
            sequence += 1;
            return envelope;
        },
        finish(finish: ModelProviderFinish) {
            const envelope = { ...identity, sequence, finish };
            sequence += 1;
            return envelope;
        },
    };
}

function compileTextRequest(provider: 'webllm' | 'openai-compatible' = 'webllm') {
    const protocol = createModelProviderProtocol({ provider, model: 'fixture-model' });
    const compiled = protocol.compileRequest({
        correlationId: 'request-1',
        operation: 'text',
        modality: 'text',
        messages: [
            { role: 'system', content: 'Be precise.' },
            { role: 'user', content: 'Describe the mix.' },
        ],
        stream: true,
        limits: { maxOutputTokens: 32 },
        controls: { cache: 'provider-default', reasoning: 'provider-default' },
        budget: { maxInputTokens: 100, maxOutputTokens: 32, maxTotalTokens: 132 },
        dataPolicy: provider === 'webllm' ? 'local-only' : 'remote-allowed',
        ...(provider === 'webllm'
            ? {}
            : {
                  dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES],
                  remoteDisclosure: remoteTransmissionDisclosure.issue({
                      categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
                      correlationId: 'request-1',
                      requestId: 'request-1',
                  }),
              }),
    });
    if (compiled.status !== 'ready') {
        throw new Error(compiled.failure.safeMessage);
    }
    return { protocol, request: compiled.request };
}

describe('modelProviderProtocol', () => {
    it('rejects unknown remote categories before disclosure consumption or provider invocation', () => {
        const hosted = createModelProviderProtocol({ provider: 'openai-compatible', model: 'fixture-model' });
        const invokeProvider = vi.fn();
        const categories = ['prompt-text', 'unknown-category'] as never;
        const compiled = hosted.compileRequest({
            correlationId: 'unknown-category-request',
            operation: 'tools',
            modality: 'text',
            messages: [{ role: 'user', content: 'Describe the mix.' }],
            tools: [],
            stream: false,
            limits: { maxOutputTokens: 64 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 100, maxOutputTokens: 64, maxTotalTokens: 164 },
            dataPolicy: 'remote-allowed',
            dataCategories: categories,
            remoteDisclosure: remoteTransmissionDisclosure.issue({
                categories,
                correlationId: 'unknown-category-request',
                requestId: 'unknown-category-request',
            }),
        });

        if (compiled.status === 'ready') {
            invokeProvider(compiled.request);
        }

        expect(compiled).toMatchObject({ status: 'unavailable', failure: { code: 'remote-data-policy-rejected' } });
        expect(invokeProvider).not.toHaveBeenCalled();
    });

    it('rejects raw audio before a hosted provider can be invoked', () => {
        const hosted = createModelProviderProtocol({ provider: 'openai-compatible', model: 'fixture-model' });
        const invokeProvider = vi.fn();
        const compiled = hosted.compileRequest({
            correlationId: 'raw-audio-request',
            operation: 'tools',
            modality: 'text',
            messages: [{ role: 'user', content: 'Process this recording.' }],
            tools: [],
            stream: false,
            limits: { maxOutputTokens: 64 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 100, maxOutputTokens: 64, maxTotalTokens: 164 },
            dataPolicy: 'remote-allowed',
            dataCategories: ['raw-audio'],
            remoteDisclosure: {} as never,
        });

        if (compiled.status === 'ready') {
            invokeProvider(compiled.request);
        }

        expect(compiled).toMatchObject({ status: 'unavailable', failure: { code: 'remote-data-policy-rejected' } });
        expect(invokeProvider).not.toHaveBeenCalled();
    });

    it('rejects forged, mismatched, and replayed hosted disclosure evidence before invocation', () => {
        const hosted = createModelProviderProtocol({ provider: 'openai-compatible', model: 'fixture-model' });
        const base = {
            operation: 'tools' as const,
            modality: 'text' as const,
            messages: [{ role: 'user' as const, content: 'Mute the drums.' }],
            tools: [],
            stream: false,
            limits: { maxOutputTokens: 64 },
            controls: { cache: 'provider-default' as const, reasoning: 'provider-default' as const },
            budget: { maxInputTokens: 100, maxOutputTokens: 64, maxTotalTokens: 164 },
            dataPolicy: 'remote-allowed' as const,
            dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES],
        };
        const forged = hosted.compileRequest({
            ...base,
            correlationId: 'forged',
            remoteDisclosure: {} as never,
        });
        const mismatchedEvidence = remoteTransmissionDisclosure.issue({
            categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
            correlationId: 'issued',
            requestId: 'issued',
        });
        const mismatched = hosted.compileRequest({
            ...base,
            correlationId: 'different',
            remoteDisclosure: mismatchedEvidence,
        });
        const replayedEvidence = remoteTransmissionDisclosure.issue({
            categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
            correlationId: 'replay',
            requestId: 'replay',
        });
        const firstUse = hosted.compileRequest({
            ...base,
            correlationId: 'replay',
            remoteDisclosure: replayedEvidence,
        });
        const secondUse = hosted.compileRequest({
            ...base,
            correlationId: 'replay',
            remoteDisclosure: replayedEvidence,
        });

        expect(forged).toMatchObject({ status: 'unavailable', failure: { code: 'remote-data-policy-rejected' } });
        expect(mismatched).toMatchObject({ status: 'unavailable', failure: { code: 'remote-data-policy-rejected' } });
        expect(firstUse).toMatchObject({ status: 'ready' });
        expect(secondUse).toMatchObject({ status: 'ready' });
        if (firstUse.status !== 'ready' || secondUse.status !== 'ready') {
            throw new Error('Expected valid hosted disclosure evidence to compile.');
        }
        hosted.start(firstUse.request);
        expect(() => hosted.start(secondUse.request)).toThrow('lacks admitted data disclosure');
    });

    it('publishes the complete provider-neutral protocol surface', () => {
        expect(getAiRuntimeProtocolContracts().providerProtocol).toMatchObject({
            schemaVersion: 2,
            capabilities: [
                'provider-neutral-text-tools-and-structured-output',
                'delta-snapshot-and-final-events',
                'usage-provenance-and-reconciliation',
                'context-output-and-run-budgets',
                'cache-reasoning-and-data-policy-controls',
                'typed-retryability-safe-diagnostics-and-partial-output',
                'fixed-unavailable-media-modalities',
                'unknown-future-event-tolerance',
                'stream-cancellation',
                'run-request-call-sequence-and-cancellation-generation-correlation',
                'bounded-events-buffers-and-payloads',
                'schema-validated-complete-tool-arguments',
                'exactly-one-terminal-and-late-event-rejection',
            ],
            operations: [
                { name: 'text', version: '2', availability: 'available' },
                { name: 'tools', version: '2', availability: 'available' },
                { name: 'structured-output', version: '2', availability: 'available' },
            ],
        });
    });

    it('compiles one provider-neutral request and publishes capability-honest unavailable results', () => {
        const webLlm = createModelProviderProtocol({ provider: 'webllm', model: 'qwen-fixture' });
        const text = webLlm.compileRequest({
            correlationId: 'request-text',
            operation: 'text',
            modality: 'text',
            messages: [{ role: 'user', content: 'Explain the chorus.' }],
            stream: true,
            limits: { maxOutputTokens: 256 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 1_000, maxOutputTokens: 256, maxTotalTokens: 1_256 },
            dataPolicy: 'local-only',
        });
        const image = webLlm.compileRequest({
            correlationId: 'request-image',
            operation: 'text',
            modality: 'image',
            messages: [{ role: 'user', content: 'Inspect this image.' }],
            stream: false,
            limits: { maxOutputTokens: 64 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 100, maxOutputTokens: 64, maxTotalTokens: 164 },
            dataPolicy: 'local-only',
        });

        expect(text).toMatchObject({
            status: 'ready',
            request: {
                schemaVersion: 2,
                correlationId: 'request-text',
                operation: 'text',
                modality: 'text',
            },
        });
        expect(webLlm.capabilities).toMatchObject({
            text: true,
            tools: true,
            streaming: true,
            contextWindowTokens: null,
            maxOutputTokens: null,
            media: { audio: 'unavailable', image: 'unavailable', video: 'unavailable' },
        });
        expect(image).toEqual({
            status: 'unavailable',
            failure: {
                code: 'modality-unavailable',
                correlationId: 'request-image',
                partialOutputDisposition: 'none',
                retryable: false,
                safeMessage: 'The webllm provider does not support image input.',
            },
        });
    });

    it('fails closed on unsupported controls, local-only remote data, and parallel tools', () => {
        const hosted = createModelProviderProtocol({ provider: 'openai-compatible', model: 'fixture-model' });
        const base = {
            correlationId: 'request-controls',
            operation: 'tools' as const,
            modality: 'text' as const,
            messages: [{ role: 'user' as const, content: 'Mute the drums.' }],
            tools: [{ name: 'setTrackMute', description: 'Mute a track.', parameters: { type: 'object' } }],
            stream: false,
            limits: { maxOutputTokens: 64 },
            budget: { maxInputTokens: 100, maxOutputTokens: 64, maxTotalTokens: 164 },
        };

        expect(
            hosted.compileRequest({
                ...base,
                controls: { cache: 'bypass', reasoning: 'provider-default' },
                dataPolicy: 'remote-allowed',
            })
        ).toMatchObject({ status: 'unavailable', failure: { code: 'cache-control-unavailable' } });
        expect(
            hosted.compileRequest({
                ...base,
                controls: { cache: 'provider-default', reasoning: 'enabled' },
                dataPolicy: 'remote-allowed',
            })
        ).toMatchObject({ status: 'unavailable', failure: { code: 'reasoning-control-unavailable' } });
        expect(
            hosted.compileRequest({
                ...base,
                controls: { cache: 'provider-default', reasoning: 'provider-default' },
                dataPolicy: 'local-only',
            })
        ).toMatchObject({ status: 'unavailable', failure: { code: 'data-policy-unavailable' } });
        expect(
            hosted.compileRequest({
                ...base,
                allowParallelToolCalls: true,
                controls: { cache: 'provider-default', reasoning: 'provider-default' },
                dataPolicy: 'remote-allowed',
            })
        ).toMatchObject({ status: 'unavailable', failure: { code: 'parallel-tools-unavailable' } });
    });

    it('normalizes delta, cumulative-snapshot, and final usage without double-counting', () => {
        const { protocol, request } = compileTextRequest();
        const session = protocol.start(request);
        const source = createModelProviderStreamSource(request);

        session.push(source.push({ type: 'text', mode: 'delta', text: 'Hel' }));
        session.push(source.push({ type: 'text', mode: 'cumulative-snapshot', text: 'Hello' }));
        session.push(source.push({ type: 'text', mode: 'delta', text: '!' }));
        session.push(
            source.push({
                type: 'usage',
                mode: 'delta',
                usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 0 },
                provenance: 'versioned-estimate',
            })
        );
        session.push(
            source.push({
                type: 'usage',
                mode: 'cumulative-snapshot',
                usage: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 1, reasoningTokens: 0 },
                provenance: 'provider-reported',
            })
        );
        session.push(
            source.push({
                type: 'usage',
                mode: 'delta',
                usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 1 },
                provenance: 'provider-reported',
            })
        );
        session.push(
            source.push({
                type: 'usage',
                mode: 'final',
                usage: { inputTokens: 13, outputTokens: 5, cachedInputTokens: 1, reasoningTokens: 1 },
                provenance: 'provider-reported',
            })
        );

        expect(session.finish(source.finish({ reason: 'stop' }))).toMatchObject({
            status: 'complete',
            output: { text: 'Hello!' },
            usage: {
                inputTokens: 13,
                outputTokens: 5,
                cachedInputTokens: 1,
                reasoningTokens: 1,
                provenance: 'provider-reported',
            },
        });
    });

    it('preserves unavailable counters when a provider reports a sparse usage delta', () => {
        const { protocol, request } = compileTextRequest();
        const session = protocol.start(request);
        const source = createModelProviderStreamSource(request);

        session.push(
            source.push({
                type: 'usage',
                mode: 'delta',
                usage: { inputTokens: null, outputTokens: 4, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            })
        );

        expect(session.finish(source.finish({ reason: 'stop' })).usage).toEqual({
            inputTokens: null,
            outputTokens: 4,
            cachedInputTokens: null,
            reasoningTokens: null,
            provenance: 'provider-reported',
        });
    });

    it('normalizes tools, structured output, reasoning, and unknown future events', () => {
        const protocol = createModelProviderProtocol({ provider: 'native', model: 'fixture-model' });
        const compiled = protocol.compileRequest({
            correlationId: 'request-structured',
            operation: 'structured-output',
            modality: 'text',
            messages: [{ role: 'user', content: 'Return a mix summary.' }],
            tools: [{ name: 'analyzeMix', description: 'Analyze the mix.', parameters: { type: 'object' } }],
            responseSchema: { type: 'object', required: ['summary'] },
            stream: true,
            limits: { maxOutputTokens: 64 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 100, maxOutputTokens: 64, maxTotalTokens: 164 },
            dataPolicy: 'local-only',
        });
        if (compiled.status !== 'ready') {
            throw new Error(compiled.failure.safeMessage);
        }
        const session = protocol.start(compiled.request);
        const source = createModelProviderStreamSource(compiled.request);
        session.push(source.push({ type: 'reasoning', mode: 'delta', text: 'Checking levels.' }));
        session.push(source.push({ type: 'tool-call', call: { id: 'call-1', name: 'analyzeMix', arguments: {} } }));
        session.push(source.push({ type: 'structured-output', value: { summary: 'Balanced' } }));
        session.push(source.push({ type: 'unknown', providerEventType: 'future.telemetry.packet' }));

        expect(session.finish(source.finish({ reason: 'stop' }))).toMatchObject({
            status: 'complete',
            ignoredProviderEvents: ['future.telemetry.packet'],
            output: {
                reasoning: 'Checking levels.',
                structuredOutput: { summary: 'Balanced' },
                toolCalls: [{ id: 'call-1', name: 'analyzeMix', arguments: {} }],
            },
        });
    });

    it.each([
        { type: 'text', mode: 'invalid', text: 'unsafe' },
        { type: 'reasoning', mode: 'delta', text: 12 },
        {
            type: 'usage',
            mode: 'final',
            usage: { inputTokens: -1, outputTokens: 1, cachedInputTokens: null, reasoningTokens: null },
            provenance: 'provider-reported',
        },
        { type: 'future-event', providerEventType: 'future-event' },
        { type: 'unknown' },
    ])('rejects a malformed runtime provider event before applying it: %j', (malformedEvent) => {
        const { protocol, request } = compileTextRequest();
        const session = protocol.start(request);
        const source = createModelProviderStreamSource(request);

        expect(() => session.push(source.push(malformedEvent as unknown as ModelProviderEvent))).toThrow(
            'invalid runtime shape'
        );
    });

    it.each([{ reason: 'bogus' }, { reason: 'error' }, { reason: 'refusal', failure: { code: '', retryable: 1 } }])(
        'rejects a malformed terminal outcome before finishing the session: %j',
        (malformedFinish) => {
            const { protocol, request } = compileTextRequest();
            const session = protocol.start(request);
            const source = createModelProviderStreamSource(request);

            expect(() => session.finish(source.finish(malformedFinish as unknown as ModelProviderFinish))).toThrow(
                'invalid runtime shape'
            );
        }
    );

    it('returns typed retryability, safe diagnostics, correlation, and partial-output disposition', () => {
        const { protocol, request } = compileTextRequest('openai-compatible');
        const session = protocol.start(request);
        const source = createModelProviderStreamSource(request);
        session.push(source.push({ type: 'text', mode: 'delta', text: 'Partial answer' }));

        expect(
            session.finish(
                source.finish({
                    reason: 'error',
                    failure: {
                        code: 'rate-limited',
                        retryable: true,
                        safeMessage: 'The provider is temporarily rate limited.',
                    },
                })
            )
        ).toMatchObject({
            status: 'partial',
            correlationId: 'request-1',
            partialOutputDisposition: 'preserve',
            failure: {
                code: 'rate-limited',
                correlationId: 'request-1',
                retryable: true,
                safeMessage: 'The provider is temporarily rate limited.',
            },
            output: { text: 'Partial answer' },
        });
    });

    it('terminates over-budget output as typed partial output', () => {
        const { protocol, request } = compileTextRequest();
        const session = protocol.start(request);
        const source = createModelProviderStreamSource(request);
        session.push(source.push({ type: 'text', mode: 'delta', text: 'Bounded partial answer' }));
        session.push(
            source.push({
                type: 'usage',
                mode: 'final',
                usage: { inputTokens: 100, outputTokens: 33, cachedInputTokens: 0, reasoningTokens: 0 },
                provenance: 'provider-reported',
            })
        );

        expect(session.finish(source.finish({ reason: 'stop' }))).toMatchObject({
            status: 'partial',
            partialOutputDisposition: 'preserve',
            failure: { code: 'budget-exhausted', retryable: false },
        });
    });
});
