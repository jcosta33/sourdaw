import { describe, expect, it, vi } from 'vitest';

import { NativeToolCallingProtocolError } from '../../errors/NativeToolCallingProtocolError';
import { ToolPlanningRejectedError } from '../../errors/ToolPlanningRejectedError';
import { createModelProviderProtocol } from '../../useCases/modelProviderProtocol';
import {
    runNativeModelProviderRequest,
    type NativeModelProviderAdapterDependencies,
} from '../nativeModelProviderAdapter';

function createDependencies(
    overrides: Partial<NativeModelProviderAdapterDependencies> = {}
): NativeModelProviderAdapterDependencies {
    return {
        generateCompletion: vi.fn(async () => ''),
        generateSchemaConstrainedCompletion: vi.fn(async () => null),
        generateToolCalls: vi.fn(async () => null),
        isReady: () => true,
        streamCompletion: vi.fn(async () => undefined),
        ...overrides,
    };
}

function createFixture(input: {
    operation: 'text' | 'tools' | 'structured-output';
    stream?: boolean;
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    responseSchema?: Record<string, unknown>;
}) {
    const protocol = createModelProviderProtocol({ provider: 'native', model: 'native-fixture' });
    const compiled = protocol.compileRequest({
        correlationId: 'native-correlation',
        operation: input.operation,
        modality: 'text',
        messages: [
            { role: 'system', content: 'You are a DAW assistant.' },
            { role: 'user', content: 'Describe the mix.' },
        ],
        ...(input.tools === undefined ? {} : { tools: input.tools }),
        ...(input.responseSchema === undefined ? {} : { responseSchema: input.responseSchema }),
        stream: input.stream ?? false,
        limits: { maxOutputTokens: 64 },
        controls: { cache: 'provider-default', reasoning: 'provider-default' },
        budget: { maxInputTokens: 128, maxOutputTokens: 64, maxTotalTokens: 192 },
        dataPolicy: 'local-only',
    });
    expect(compiled.status).toBe('ready');
    if (compiled.status !== 'ready') {
        throw new Error('Native fixture request must compile');
    }
    return { request: compiled.request, session: protocol.start(compiled.request) };
}

describe('native model provider adapter', () => {
    it('normalizes streamed native text, usage, correlation, and unknown events', async () => {
        const { request, session } = createFixture({ operation: 'text', stream: true });
        const outcome = await runNativeModelProviderRequest(
            { request, onEvent: (event) => session.push(event) },
            createDependencies({
                streamCompletion: vi.fn(async (_messages, onToken, options) => {
                    onToken('solid ');
                    onToken('mix');
                    options.onUnknownEvent?.('native:future-event');
                    options.onUsage?.({
                        type: 'usage',
                        mode: 'final',
                        usage: {
                            inputTokens: 12,
                            outputTokens: 2,
                            cachedInputTokens: null,
                            reasoningTokens: null,
                        },
                        provenance: 'provider-reported',
                    });
                    options.onFinish?.('stop');
                }),
            })
        );
        expect(outcome.status).toBe('available');
        if (outcome.status !== 'available') {
            throw new Error('Native fixture runtime must be available');
        }

        expect(session.finish(outcome.finish)).toMatchObject({
            provider: 'native',
            model: 'native-fixture',
            correlationId: 'native-correlation',
            status: 'complete',
            output: { text: 'solid mix' },
            usage: { inputTokens: 12, outputTokens: 2, provenance: 'provider-reported' },
            ignoredProviderEvents: ['native:future-event'],
        });
    });

    it('rejects streamed text without a provider terminal event', async () => {
        const { request } = createFixture({ operation: 'text', stream: true });

        await expect(
            runNativeModelProviderRequest(
                { request, onEvent: vi.fn() },
                createDependencies({
                    streamCompletion: vi.fn(async (_messages, onToken) => {
                        onToken('partial output');
                    }),
                })
            )
        ).resolves.toEqual({
            status: 'available',
            finish: {
                reason: 'error',
                failure: {
                    code: 'native-stream-incomplete',
                    retryable: true,
                    safeMessage: 'The native model provider stream ended without a terminal event.',
                },
            },
        });
    });

    it('normalizes non-streaming text as one cumulative snapshot', async () => {
        const { request, session } = createFixture({ operation: 'text' });
        const outcome = await runNativeModelProviderRequest(
            { request, onEvent: (event) => session.push(event) },
            createDependencies({
                generateCompletion: vi.fn(async () => 'two parts'),
            })
        );
        expect(outcome.status).toBe('available');
        if (outcome.status !== 'available') {
            throw new Error('Native fixture runtime must be available');
        }
        expect(session.finish(outcome.finish).output.text).toBe('two parts');
    });

    it('fails closed instead of dropping normalized conversation history', async () => {
        const { request } = createFixture({ operation: 'text' });
        const unsupportedMessages = [
            [
                { role: 'system' as const, content: 'You are a DAW assistant.' },
                { role: 'user' as const, content: 'Describe the mix.' },
                { role: 'assistant' as const, content: 'The drums are forward.' },
                { role: 'user' as const, content: 'What should change next?' },
            ],
            [
                { role: 'user' as const, content: 'Describe the mix.' },
                { role: 'system' as const, content: 'You are a DAW assistant.' },
            ],
        ];

        for (const messages of unsupportedMessages) {
            await expect(
                runNativeModelProviderRequest(
                    { request: { ...request, messages }, onEvent: vi.fn() },
                    createDependencies()
                )
            ).resolves.toEqual({
                status: 'available',
                finish: {
                    reason: 'error',
                    failure: {
                        code: 'native-conversation-history-unsupported',
                        retryable: false,
                        safeMessage: 'The native model provider does not support this conversation history.',
                    },
                },
            });
        }
    });

    it('fails closed on streamed histories that the native bridge cannot preserve', async () => {
        const { request } = createFixture({ operation: 'text', stream: true });
        const streamCompletion = vi.fn<NativeModelProviderAdapterDependencies['streamCompletion']>();
        const unsupportedMessages = [
            [
                { role: 'system' as const, content: 'Primary instructions.' },
                { role: 'system' as const, content: 'Additional instructions.' },
                { role: 'user' as const, content: 'Describe the mix.' },
            ],
            [
                { role: 'system' as const, content: 'Primary instructions.' },
                { role: 'tool' as const, content: 'Tool result.' },
                { role: 'user' as const, content: 'Describe the mix.' },
            ],
            [
                { role: 'user' as const, content: 'Describe the mix.' },
                { role: 'system' as const, content: 'Primary instructions.' },
                { role: 'assistant' as const, content: 'The drums are forward.' },
            ],
        ];

        for (const messages of unsupportedMessages) {
            await expect(
                runNativeModelProviderRequest(
                    { request: { ...request, messages }, onEvent: vi.fn() },
                    createDependencies({ streamCompletion })
                )
            ).resolves.toEqual({
                status: 'available',
                finish: {
                    reason: 'error',
                    failure: {
                        code: 'native-conversation-history-unsupported',
                        retryable: false,
                        safeMessage: 'The native model provider does not support this conversation history.',
                    },
                },
            });
        }
        expect(streamCompletion).not.toHaveBeenCalled();
    });

    it('normalizes native tool calls and app-owns missing correlation IDs', async () => {
        const { request, session } = createFixture({
            operation: 'tools',
            tools: [{ name: 'setTempo', description: 'Set tempo', parameters: { type: 'object' } }],
        });
        const outcome = await runNativeModelProviderRequest(
            { request, onEvent: (event) => session.push(event) },
            createDependencies({
                generateToolCalls: vi.fn(async () => [
                    { name: 'setTempo', arguments: { tempo: 120 } },
                    { id: 'provider-call', name: 'setTempo', arguments: { tempo: 121 } },
                ]),
            })
        );
        expect(outcome.status).toBe('available');
        if (outcome.status !== 'available') {
            throw new Error('Native fixture runtime must be available');
        }
        expect(session.finish(outcome.finish).output.toolCalls).toEqual([
            { id: 'native-correlation:0', name: 'setTempo', arguments: { tempo: 120 } },
            { id: 'provider-call', name: 'setTempo', arguments: { tempo: 121 } },
        ]);
    });

    it('normalizes schema-constrained output through the shared protocol', async () => {
        const { request, session } = createFixture({
            operation: 'structured-output',
            responseSchema: { type: 'object', required: ['summary'] },
        });
        const outcome = await runNativeModelProviderRequest(
            { request, onEvent: (event) => session.push(event) },
            createDependencies({ generateSchemaConstrainedCompletion: vi.fn(async () => '{"summary":"balanced"}') })
        );
        expect(outcome.status).toBe('available');
        if (outcome.status !== 'available') {
            throw new Error('Native fixture runtime must be available');
        }
        expect(session.finish(outcome.finish).output.structuredOutput).toEqual({ summary: 'balanced' });
    });

    it('keeps semantic rejection distinct from an unhealthy native tool protocol', async () => {
        const semanticFixture = createFixture({
            operation: 'tools',
            tools: [{ name: 'setTempo', description: 'Set tempo', parameters: { type: 'object' } }],
        });
        await expect(
            runNativeModelProviderRequest(
                { request: semanticFixture.request, onEvent: vi.fn() },
                createDependencies({
                    generateToolCalls: vi.fn(async () => {
                        throw new ToolPlanningRejectedError('Native tool plan was incomplete');
                    }),
                })
            )
        ).resolves.toEqual({
            status: 'available',
            finish: {
                reason: 'error',
                failure: {
                    code: 'tool-planning-rejected',
                    retryable: false,
                    safeMessage: 'Native tool plan was incomplete',
                },
            },
        });

        const protocolFixture = createFixture({
            operation: 'tools',
            tools: [{ name: 'setTempo', description: 'Set tempo', parameters: { type: 'object' } }],
        });
        await expect(
            runNativeModelProviderRequest(
                { request: protocolFixture.request, onEvent: vi.fn() },
                createDependencies({
                    generateToolCalls: vi.fn(async () => {
                        throw new NativeToolCallingProtocolError('private malformed DTO detail');
                    }),
                })
            )
        ).resolves.toEqual({
            status: 'available',
            finish: {
                reason: 'error',
                failure: {
                    code: 'native-tool-protocol-invalid',
                    retryable: true,
                    safeMessage: 'The native model provider returned an invalid tool response.',
                },
            },
        });
    });

    it('reports lifecycle unavailability with the exact request correlation', async () => {
        const { request } = createFixture({ operation: 'text' });
        await expect(
            runNativeModelProviderRequest({ request, onEvent: vi.fn() }, createDependencies({ isReady: () => false }))
        ).resolves.toEqual({
            status: 'unavailable',
            failure: {
                code: 'native-provider-unavailable',
                correlationId: 'native-correlation',
                retryable: true,
                safeMessage: 'The native model provider is not running.',
                partialOutputDisposition: 'none',
            },
        });
    });

    it('classifies cancellation and timeout without exposing native errors', async () => {
        const cancelled = new AbortController();
        cancelled.abort(new DOMException('Stopped', 'AbortError'));
        const cancelledFixture = createFixture({ operation: 'text' });
        await expect(
            runNativeModelProviderRequest(
                {
                    request: cancelledFixture.request,
                    onEvent: vi.fn(),
                    signal: cancelled.signal,
                },
                createDependencies()
            )
        ).resolves.toEqual({ status: 'available', finish: { reason: 'cancelled' } });

        const timeoutFixture = createFixture({ operation: 'text' });
        const timeoutOutcome = await runNativeModelProviderRequest(
            { request: timeoutFixture.request, onEvent: vi.fn(), timeoutMs: 5 },
            createDependencies({
                generateCompletion: vi.fn(async () => {
                    throw new Error('Native inference timed out after 5ms');
                }),
            })
        );
        expect(timeoutOutcome).toEqual({
            status: 'available',
            finish: {
                reason: 'error',
                failure: {
                    code: 'native-provider-timeout',
                    retryable: true,
                    safeMessage: 'The native model provider request timed out.',
                },
            },
        });
    });

    it('normalizes a native output limit as length instead of provider failure', async () => {
        const { request } = createFixture({ operation: 'text', stream: true });
        await expect(
            runNativeModelProviderRequest(
                { request, onEvent: vi.fn() },
                createDependencies({
                    streamCompletion: vi.fn(async () => {
                        throw new Error('Native completion stream ended incompletely with finish reason length');
                    }),
                })
            )
        ).resolves.toEqual({ status: 'available', finish: { reason: 'length' } });
    });
});
