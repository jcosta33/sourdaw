import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateOpenAiCompatibleToolCalls } from '../cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { streamOpenAiCompatibleChatCompletion } from '../cloudLlm/cloudInference/streamOpenAiCompatibleChatCompletion';
import { type OpenAiCompatibleCloudRuntime } from '../cloudLlm/cloudSession';
import { normalizeProviderCapabilityProbe } from '../normalizeProviderCapabilityProbe';
import { compileProviderAdapterInstallation, type ProviderAdapterInstallationInput } from '../providerAdapterRegistry';
import { runProviderGatewayRequest, type ProviderGatewayDependencies } from '../providerGateway';

type TestGatewayChannel = {
    id: number;
    onmessage: (event: unknown) => void;
    toJSON: () => string;
};

const tauriHarness = vi.hoisted(() => {
    const channels: TestGatewayChannel[] = [];
    let nextChannelId = 100;
    return {
        channels,
        createChannel: vi.fn(async () => {
            const id = nextChannelId;
            nextChannelId += 1;
            const channel: TestGatewayChannel = {
                id,
                onmessage: (_event: unknown) => undefined,
                toJSON: () => `__CHANNEL__:${String(id)}`,
            };
            channels.push(channel);
            return channel;
        }),
        invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    };
});

vi.mock('#/utils/tauriBridge', () => ({
    createChannel: tauriHarness.createChannel,
    tauriInvoke: tauriHarness.invoke,
}));

const BASE_INSTALLATION: ProviderAdapterInstallationInput = {
    adapterId: 'builtin.openai-compatible.chat-completions.v1',
    providerId: 'studio-provider',
    modelId: 'studio-model-v1',
    protocolFamily: 'openai-chat-completions',
    origin: 'https://models.example.test:8443',
};

function createAdapterRuntime(): OpenAiCompatibleCloudRuntime {
    return {
        provider: 'openai-compatible',
        api_key: 'remote-secret',
        model: 'studio-model-v1',
        base_url: 'https://models.example.test:8443/v1',
        adapter: compileProviderAdapterInstallation(BASE_INSTALLATION),
    };
}

function gatewayEvent(
    requestId: unknown,
    sequence: number,
    event: string,
    data: Record<string, unknown> = {}
): Record<string, unknown> {
    return { event, data: { ...data, requestId, sequence } };
}

function installGatewayResponses(requestChunks: readonly string[], requestContentType: string): void {
    const encoder = new TextEncoder();
    tauriHarness.invoke.mockImplementation(async (command, args) => {
        if (command !== 'provider_gateway_request') {
            return undefined;
        }
        const channelValue = args?.onEvent;
        if (
            typeof channelValue !== 'object' ||
            channelValue === null ||
            !('onmessage' in channelValue) ||
            typeof channelValue.onmessage !== 'function'
        ) {
            throw new Error('Expected a provider gateway event channel');
        }
        const channel = channelValue as TestGatewayChannel;
        const operation = args?.operation;
        const requestId = args?.requestId;
        const chunks = operation === 'probe' ? ['{"data":[{"id":"studio-model-v1"}]}'] : Array.from(requestChunks);
        let sequence = 0;
        channel.onmessage(
            gatewayEvent(requestId, sequence++, 'response-start', {
                status: 200,
                contentType: operation === 'probe' ? 'application/json' : requestContentType,
            })
        );
        for (const chunk of chunks) {
            channel.onmessage(
                gatewayEvent(requestId, sequence++, 'body-chunk', { bytes: Array.from(encoder.encode(chunk)) })
            );
        }
        channel.onmessage(gatewayEvent(requestId, sequence, 'done'));
        return undefined;
    });
}

describe('provider adapter conformance', () => {
    afterEach(() => {
        tauriHarness.channels.length = 0;
        tauriHarness.createChannel.mockClear();
        tauriHarness.invoke.mockReset();
        vi.unstubAllGlobals();
    });
    it('compiles a stable installed adapter into the privileged provider contract', () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);

        expect(adapter).toMatchObject({
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            providerId: 'studio-provider',
            modelId: 'studio-model-v1',
            protocolFamily: 'openai-chat-completions',
            origin: 'https://models.example.test:8443',
            transport: {
                kind: 'privileged-origin',
                dnsAdmission: 'public-global-only',
                redirects: 'disabled',
                proxy: 'disabled',
            },
        });
        expect(adapter.capabilities).toMatchObject({ text: true, tools: true, streaming: true });
    });

    it.each([
        ['model supplied URL', { ...BASE_INSTALLATION, modelUrl: 'https://evil.example' }],
        ['adapter code', { ...BASE_INSTALLATION, executableCode: 'fetch("https://evil.example")' }],
        ['non-canonical path', { ...BASE_INSTALLATION, origin: 'https://models.example.test/v1' }],
        ['credentials', { ...BASE_INSTALLATION, origin: 'https://secret@models.example.test' }],
        ['private destination', { ...BASE_INSTALLATION, origin: 'https://192.168.1.10:8443' }],
        ['metadata destination', { ...BASE_INSTALLATION, origin: 'https://169.254.169.254' }],
        ['deprecated IPv4 relay', { ...BASE_INSTALLATION, origin: 'https://192.88.99.2' }],
        ['IPv4 documentation range', { ...BASE_INSTALLATION, origin: 'https://198.51.100.1' }],
        ['IPv6 translation space', { ...BASE_INSTALLATION, origin: 'https://[64:ff9b:1::1]' }],
        ['IPv6 discard prefix', { ...BASE_INSTALLATION, origin: 'https://[100::1]' }],
        ['deprecated IPv6 6to4', { ...BASE_INSTALLATION, origin: 'https://[2002:a00:1::1]' }],
        ['IPv6 documentation prefix', { ...BASE_INSTALLATION, origin: 'https://[3fff::1]' }],
        ['IPv6 segment routing test prefix', { ...BASE_INSTALLATION, origin: 'https://[5f00::1]' }],
        ['unknown adapter', { ...BASE_INSTALLATION, adapterId: 'downloaded.javascript.adapter' }],
    ])('rejects %s before transport', (_label, input) => {
        expect(() => compileProviderAdapterInstallation(input)).toThrow();
    });

    it('normalizes the compiled capability probe and rejects another model', () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        expect(normalizeProviderCapabilityProbe(adapter, { data: [{ id: 'studio-model-v1' }] })).toBe(
            adapter.capabilities
        );
        expect(() => normalizeProviderCapabilityProbe(adapter, { data: [{ id: 'other-model' }] })).toThrow(
            'did not advertise'
        );
    });

    it('uses only the privileged gateway and cancels by request ID', async () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        const invoke = vi.fn<ProviderGatewayDependencies['invoke']>();
        let rejectedCancel: Promise<unknown> | undefined;
        let readCancelCatchCount: (() => number) | undefined;
        let resolveRequest: (() => void) | undefined;
        invoke.mockImplementation((command) => {
            if (command === 'provider_gateway_request') {
                return new Promise<void>((resolve) => {
                    resolveRequest = resolve;
                });
            }
            if (command === 'cancel_provider_gateway_request') {
                rejectedCancel = Promise.reject(new Error('cancel IPC unavailable'));
                const cancelCatch = vi.spyOn(rejectedCancel, 'catch');
                readCancelCatchCount = () => cancelCatch.mock.calls.length;
                return rejectedCancel;
            }
            return Promise.resolve(undefined);
        });
        const channel = { id: 1, onmessage: (_event: unknown) => undefined, toJSON: () => '__CHANNEL__:1' };
        const dependencies: ProviderGatewayDependencies = {
            createChannel: async () => channel,
            invoke,
        };
        const controller = new AbortController();
        const onBodyChunk = vi.fn();
        const pending = runProviderGatewayRequest(
            {
                requestId: 'request-1',
                adapter,
                operation: 'request',
                apiKey: 'secret-not-in-errors',
                body: '{"model":"studio-model-v1"}',
                signal: controller.signal,
                onResponseStart: () => undefined,
                onBodyChunk,
            },
            dependencies
        );
        await vi.waitFor(() => expect(resolveRequest).toBeTypeOf('function'));
        const queuedLateEvent = channel.onmessage;
        controller.abort();
        const productionCancelCatchCount = readCancelCatchCount?.() ?? 0;
        void rejectedCancel?.catch(() => undefined);
        resolveRequest?.();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(invoke).toHaveBeenCalledWith('provider_gateway_request', {
            requestId: 'request-1',
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            origin: 'https://models.example.test:8443',
            operation: 'request',
            apiKey: 'secret-not-in-errors',
            body: '{"model":"studio-model-v1"}',
            onEvent: channel,
        });
        expect(invoke).toHaveBeenCalledWith('cancel_provider_gateway_request', { requestId: 'request-1' });
        expect(productionCancelCatchCount).toBe(1);
        queuedLateEvent({ event: 'body-chunk', data: { bytes: [123] } });
        expect(onBodyChunk).not.toHaveBeenCalled();
    });

    it('does not dispatch after aborting during channel creation', async () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        const invoke = vi.fn<ProviderGatewayDependencies['invoke']>(async () => undefined);
        const channel = { id: 4, onmessage: (_event: unknown) => undefined, toJSON: () => '__CHANNEL__:4' };
        let resolveChannel: ((value: typeof channel) => void) | undefined;
        const createChannel = vi.fn(
            () =>
                new Promise<typeof channel>((resolve) => {
                    resolveChannel = resolve;
                })
        );
        const controller = new AbortController();
        const pending = runProviderGatewayRequest(
            {
                requestId: 'request-channel-race',
                adapter,
                operation: 'request',
                apiKey: 'stale-secret',
                body: '{"stale":true}',
                signal: controller.signal,
                onResponseStart: () => undefined,
                onBodyChunk: () => undefined,
            },
            { createChannel, invoke }
        );

        await vi.waitFor(() => expect(resolveChannel).toBeTypeOf('function'));
        controller.abort();
        resolveChannel?.(channel);

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(invoke).not.toHaveBeenCalled();
    });

    it('maps bounded gateway events without exposing provider bodies in failures', async () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        const channel = { id: 2, onmessage: (_event: unknown) => undefined, toJSON: () => '__CHANNEL__:2' };
        const invoke = vi.fn<ProviderGatewayDependencies['invoke']>(async (command, args) => {
            if (command === 'provider_gateway_request') {
                const onEvent = args?.onEvent as typeof channel;
                onEvent.onmessage(
                    gatewayEvent(args?.requestId, 0, 'response-start', {
                        status: 200,
                        contentType: 'application/json',
                    })
                );
                onEvent.onmessage(gatewayEvent(args?.requestId, 1, 'body-chunk', { bytes: [123, 125] }));
                onEvent.onmessage(gatewayEvent(args?.requestId, 2, 'done'));
            }
        });
        const starts: unknown[] = [];
        const chunks: Uint8Array[] = [];
        await runProviderGatewayRequest(
            {
                requestId: 'request-2',
                adapter,
                operation: 'probe',
                apiKey: 'secret-not-in-errors',
                body: null,
                signal: new AbortController().signal,
                onResponseStart: (response) => starts.push(response),
                onBodyChunk: (chunk) => chunks.push(chunk),
            },
            { createChannel: async () => channel, invoke }
        );
        expect(starts).toEqual([{ status: 200, contentType: 'application/json' }]);
        expect(chunks).toEqual([Uint8Array.from([123, 125])]);

        channel.onmessage = (_event: unknown) => undefined;
        invoke.mockImplementationOnce(async (_command, args) => {
            const onEvent = args?.onEvent as typeof channel;
            onEvent.onmessage(
                gatewayEvent(args?.requestId, 0, 'response-start', {
                    status: 200,
                    contentType: 'application/json',
                })
            );
            onEvent.onmessage(gatewayEvent(args?.requestId, 1, 'body-chunk', { bytes: [999] }));
        });
        const failed = runProviderGatewayRequest(
            {
                requestId: 'request-3',
                adapter,
                operation: 'request',
                apiKey: 'secret-not-in-errors',
                body: '{"private":"request-body"}',
                signal: new AbortController().signal,
                onResponseStart: () => undefined,
                onBodyChunk: () => undefined,
            },
            { createChannel: async () => channel, invoke }
        );
        await expect(failed).rejects.toThrow('invalid body chunk');
        await expect(failed.catch((error: unknown) => String(error))).resolves.not.toMatch(
            /secret-not-in-errors|request-body/u
        );
    });

    it('rejects a cross-request gateway event before exposing response data', async () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        const channel = { id: 5, onmessage: (_event: unknown) => undefined, toJSON: () => '__CHANNEL__:5' };
        const invoke = vi.fn<ProviderGatewayDependencies['invoke']>(async (_command, args) => {
            const onEvent = args?.onEvent as typeof channel;
            onEvent.onmessage(
                gatewayEvent('another-request', 0, 'response-start', {
                    status: 200,
                    contentType: 'application/json',
                })
            );
        });
        const onResponseStart = vi.fn();

        await expect(
            runProviderGatewayRequest(
                {
                    requestId: 'request-5',
                    adapter,
                    operation: 'request',
                    apiKey: '',
                    body: '{}',
                    signal: new AbortController().signal,
                    onResponseStart,
                    onBodyChunk: vi.fn(),
                },
                { createChannel: async () => channel, invoke }
            )
        ).rejects.toThrow('cross-request or out-of-order');
        expect(onResponseStart).not.toHaveBeenCalled();
    });

    it('cancels the privileged request when downstream event handling rejects', async () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        const channel = { id: 6, onmessage: (_event: unknown) => undefined, toJSON: () => '__CHANNEL__:6' };
        let rejectRequest: ((error: Error) => void) | undefined;
        const invoke = vi.fn<ProviderGatewayDependencies['invoke']>((command, args) => {
            if (command === 'provider_gateway_request') {
                const onEvent = args?.onEvent as typeof channel;
                return new Promise<void>((_resolve, reject) => {
                    rejectRequest = reject;
                    queueMicrotask(() => {
                        onEvent.onmessage(
                            gatewayEvent(args?.requestId, 0, 'response-start', {
                                status: 200,
                                contentType: 'application/json',
                            })
                        );
                        onEvent.onmessage(gatewayEvent(args?.requestId, 1, 'body-chunk', { bytes: [123] }));
                    });
                });
            }
            if (command === 'cancel_provider_gateway_request') {
                rejectRequest?.(new Error('Native provider gateway request cancelled'));
            }
            return Promise.resolve(undefined);
        });
        const pending = runProviderGatewayRequest(
            {
                requestId: 'request-callback-failure',
                adapter,
                operation: 'request',
                apiKey: '',
                body: '{}',
                signal: new AbortController().signal,
                onResponseStart: vi.fn(),
                onBodyChunk: () => {
                    throw new Error('downstream rejected chunk');
                },
            },
            { createChannel: async () => channel, invoke }
        );
        const pendingRejection = expect(pending).rejects.toThrow('downstream rejected chunk');

        await vi.waitFor(() =>
            expect(invoke).toHaveBeenCalledWith('cancel_provider_gateway_request', {
                requestId: 'request-callback-failure',
            })
        );
        await pendingRejection;
        expect(invoke.mock.calls.filter(([command]) => command === 'cancel_provider_gateway_request')).toHaveLength(1);
    });

    it('routes adapter-backed tool planning through probe and privileged gateway without renderer fetch', async () => {
        installGatewayResponses(
            [
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                tool_calls: [
                                    {
                                        id: 'call-1',
                                        function: {
                                            name: 'muteTrack',
                                            arguments: '{"trackId":"track-1","muted":true}',
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                }),
            ],
            'application/json'
        );
        const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('renderer fetch is forbidden'));
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            generateOpenAiCompatibleToolCalls({
                runtime: createAdapterRuntime(),
                systemPrompt: 'system',
                userMessage: 'mute drums',
                toolSchemas: [
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
                ],
            })
        ).resolves.toEqual([{ id: 'call-1', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }]);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(
            tauriHarness.invoke.mock.calls
                .filter(([command]) => command === 'provider_gateway_request')
                .map(([, args]) => args?.operation)
        ).toEqual(['probe', 'request']);
    });

    it('routes adapter-backed streaming through gateway chunks without renderer fetch', async () => {
        installGatewayResponses(
            [
                'data: {"choices":[{"delta":{"content":"Privileged"}}]}\n\n',
                'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            ],
            'text/event-stream'
        );
        const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('renderer fetch is forbidden'));
        vi.stubGlobal('fetch', fetchMock);
        const onToken = vi.fn();

        await expect(
            streamOpenAiCompatibleChatCompletion({
                runtime: createAdapterRuntime(),
                messages: [{ role: 'user', content: 'help' }],
                onToken,
                signal: new AbortController().signal,
            })
        ).resolves.toBe('stop');
        expect(onToken).toHaveBeenCalledWith('Privileged');
        expect(fetchMock).not.toHaveBeenCalled();
        const requests = tauriHarness.invoke.mock.calls.filter(([command]) => command === 'provider_gateway_request');
        expect(requests.map(([, args]) => args?.operation)).toEqual(['probe', 'request']);
        expect(JSON.parse(String(requests[1]?.[1]?.body))).toMatchObject({ model: 'studio-model-v1', stream: true });
    });
});
