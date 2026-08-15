import { describe, expect, it } from 'vitest';

import { getAiRuntimeProtocolContracts } from '../getAiRuntimeProtocolContracts';
import { createModelProviderProtocol } from '../modelProviderProtocol';

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
    });
    if (compiled.status !== 'ready') {
        throw new Error(compiled.failure.safeMessage);
    }
    return { protocol, request: compiled.request };
}

describe('modelProviderProtocol', () => {
    it('publishes the complete provider-neutral protocol surface', () => {
        expect(getAiRuntimeProtocolContracts().providerProtocol).toMatchObject({
            schemaVersion: 1,
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
            ],
            operations: [
                { name: 'text', version: '1', availability: 'available' },
                { name: 'tools', version: '1', availability: 'available' },
                { name: 'structured-output', version: '1', availability: 'available' },
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
                schemaVersion: 1,
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

        session.push({ type: 'text', mode: 'delta', text: 'Hel' });
        session.push({ type: 'text', mode: 'cumulative-snapshot', text: 'Hello' });
        session.push({ type: 'text', mode: 'delta', text: '!' });
        session.push({
            type: 'usage',
            mode: 'delta',
            usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 0 },
            provenance: 'versioned-estimate',
        });
        session.push({
            type: 'usage',
            mode: 'cumulative-snapshot',
            usage: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 1, reasoningTokens: 0 },
            provenance: 'provider-reported',
        });
        session.push({
            type: 'usage',
            mode: 'delta',
            usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 1 },
            provenance: 'provider-reported',
        });
        session.push({
            type: 'usage',
            mode: 'final',
            usage: { inputTokens: 13, outputTokens: 5, cachedInputTokens: 1, reasoningTokens: 1 },
            provenance: 'provider-reported',
        });

        expect(session.finish({ reason: 'stop' })).toMatchObject({
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

        session.push({
            type: 'usage',
            mode: 'delta',
            usage: { inputTokens: null, outputTokens: 4, cachedInputTokens: null, reasoningTokens: null },
            provenance: 'provider-reported',
        });

        expect(session.finish({ reason: 'stop' }).usage).toEqual({
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
        session.push({ type: 'reasoning', mode: 'delta', text: 'Checking levels.' });
        session.push({ type: 'tool-call', call: { id: 'call-1', name: 'analyzeMix', arguments: {} } });
        session.push({ type: 'structured-output', value: { summary: 'Balanced' } });
        session.push({ type: 'unknown', providerEventType: 'future.telemetry.packet' });

        expect(session.finish({ reason: 'stop' })).toMatchObject({
            status: 'complete',
            ignoredProviderEvents: ['future.telemetry.packet'],
            output: {
                reasoning: 'Checking levels.',
                structuredOutput: { summary: 'Balanced' },
                toolCalls: [{ id: 'call-1', name: 'analyzeMix', arguments: {} }],
            },
        });
    });

    it('returns typed retryability, safe diagnostics, correlation, and partial-output disposition', () => {
        const { protocol, request } = compileTextRequest('openai-compatible');
        const session = protocol.start(request);
        session.push({ type: 'text', mode: 'delta', text: 'Partial answer' });

        expect(
            session.finish({
                reason: 'error',
                failure: {
                    code: 'rate-limited',
                    retryable: true,
                    safeMessage: 'The provider is temporarily rate limited.',
                },
            })
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
        session.push({ type: 'text', mode: 'delta', text: 'Bounded partial answer' });
        session.push({
            type: 'usage',
            mode: 'final',
            usage: { inputTokens: 100, outputTokens: 33, cachedInputTokens: 0, reasoningTokens: 0 },
            provenance: 'provider-reported',
        });

        expect(session.finish({ reason: 'stop' })).toMatchObject({
            status: 'partial',
            partialOutputDisposition: 'preserve',
            failure: { code: 'budget-exhausted', retryable: false },
        });
    });
});
