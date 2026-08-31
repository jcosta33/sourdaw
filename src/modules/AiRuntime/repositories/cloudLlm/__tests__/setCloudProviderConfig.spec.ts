import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hostedLlmProviderStatusStore } from '../../../stores/hostedLlmProviderStatusStore';
import { clearCloudProviderConfig } from '../clearCloudProviderConfig';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';
import { isCloudAvailable } from '../isCloudAvailable';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { setCloudProviderConfig } from '../setCloudProviderConfig';

type TestGatewayChannel = {
    id: number;
    onmessage: (event: unknown) => void;
    toJSON: () => string;
};

const SESSION_ID = 'provider-session-00000000000000000000000000000000';
const CANDIDATE_SESSION_ID = 'provider-session-11111111111111111111111111111111';
const DEFAULT_PROBE_BODY = '{"data":[{"id":"gpt-test"},{"id":"custom-model"}]}';

const mocks = vi.hoisted(() => {
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
        isDesktopRuntime: vi.fn(() => true),
        info: vi.fn(),
    };
});

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: mocks.isDesktopRuntime,
    desktopInvoke: mocks.invoke,
    createChannel: mocks.createChannel,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { info: mocks.info } }));

function gatewayEvent(
    requestId: unknown,
    sequence: number,
    event: string,
    data: Record<string, unknown> = {}
): Record<string, unknown> {
    return { event, data: { ...data, requestId, sequence } };
}

function emitProbeResponse(channel: TestGatewayChannel, requestId: unknown, status: number, body: string): void {
    const encoder = new TextEncoder();
    let sequence = 0;
    channel.onmessage(
        gatewayEvent(requestId, sequence++, 'response-start', {
            status,
            contentType: 'application/json',
        })
    );
    channel.onmessage(gatewayEvent(requestId, sequence++, 'body-chunk', { bytes: Array.from(encoder.encode(body)) }));
    channel.onmessage(gatewayEvent(requestId, sequence, 'done'));
}

function mockProviderGateway(
    options: {
        sessionId?: string;
        probeStatus?: number;
        probeBody?: string;
    } = {}
): void {
    const sessionId = options.sessionId ?? SESSION_ID;
    const probeStatus = options.probeStatus ?? 200;
    const probeBody = options.probeBody ?? DEFAULT_PROBE_BODY;
    mocks.invoke.mockImplementation(async (command, args) => {
        if (command === 'open_provider_gateway_session') {
            return sessionId;
        }
        if (command === 'provider_gateway_request') {
            const channelValue = args?.onEvent;
            if (
                typeof channelValue !== 'object' ||
                channelValue === null ||
                !('onmessage' in channelValue) ||
                typeof channelValue.onmessage !== 'function'
            ) {
                throw new Error('Expected a provider gateway event channel');
            }
            emitProbeResponse(channelValue as TestGatewayChannel, args?.requestId, probeStatus, probeBody);
            return undefined;
        }
        return undefined;
    });
}

describe('setCloudProviderConfig', () => {
    beforeEach(async () => {
        await clearCloudProviderConfig();
        vi.clearAllMocks();
        mocks.channels.length = 0;
        mocks.isDesktopRuntime.mockReturnValue(true);
        mockProviderGateway();
    });

    it('keeps an unauthenticated loopback provider renderer-local', async () => {
        await setCloudProviderConfig({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
            authentication: 'none',
            apiKey: '',
        });

        expect(getCloudProviderRuntime()).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            base_url: 'http://localhost:1234/v1',
            authentication: 'none',
            adapter: null,
            session_id: null,
        });
        expect(mocks.invoke).not.toHaveBeenCalledWith('open_provider_gateway_session', expect.anything());
        expect(mocks.invoke).not.toHaveBeenCalledWith('provider_gateway_request', expect.anything());
        expect(hostedLlmProviderStatusStore.value).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
            authentication: 'none',
        });
    });

    it('opens an opaque native session for remote providers', async () => {
        await setCloudProviderConfig({
            provider: 'openai',
            model: 'gpt-test',
            baseUrl: 'https://api.openai.com/v1',
            authentication: 'api-key',
            apiKey: 'sk-test-key',
        });

        expect(mocks.invoke).toHaveBeenCalledWith('open_provider_gateway_session', {
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            origin: 'https://api.openai.com',
            credentialSource: 'openai',
            credential: 'sk-test-key',
        });
        expect(mocks.invoke).toHaveBeenCalledWith(
            'provider_gateway_request',
            expect.objectContaining({
                sessionId: SESSION_ID,
                operation: 'probe',
                body: null,
            })
        );
        expect(getCloudProviderRuntime()).toMatchObject({
            provider: 'openai',
            model: 'gpt-test',
            authentication: 'api-key',
            session_id: SESSION_ID,
        });
        expect(isCloudAvailable()).toBe(true);
    });

    it('rejects a 401 probe without installing the runtime and closes the opened session', async () => {
        mockProviderGateway({ probeStatus: 401, probeBody: '{"error":"invalid_api_key"}' });

        await expect(
            setCloudProviderConfig({
                provider: 'openai',
                model: 'gpt-test',
                baseUrl: 'https://api.openai.com/v1',
                authentication: 'api-key',
                apiKey: 'asdfasdf',
            })
        ).rejects.toThrow('Provider adapter capability probe failed with status 401');

        expect(getCloudProviderRuntime()).toBeNull();
        expect(hostedLlmProviderStatusStore.value).toBeNull();
        expect(isCloudAvailable()).toBe(false);
        expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: SESSION_ID,
        });
    });

    it('rejects an OpenAI probe that does not advertise the configured model', async () => {
        mockProviderGateway({
            sessionId: CANDIDATE_SESSION_ID,
            probeBody: '{"data":[{"id":"another-model"}]}',
        });

        await expect(
            setCloudProviderConfig({
                provider: 'openai',
                model: 'gpt-test',
                baseUrl: 'https://api.openai.com/v1',
                authentication: 'api-key',
                apiKey: 'sk-test-key',
            })
        ).rejects.toThrow('did not advertise the configured model');

        expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: CANDIDATE_SESSION_ID,
        });
        expect(hostedLlmProviderStatusStore.value).toBeNull();
    });

    it('times out a stalled provider probe and closes the candidate session', async () => {
        vi.useFakeTimers();
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay);
            return controller.signal;
        });
        try {
            mocks.invoke.mockImplementation(async (command) => {
                if (command === 'open_provider_gateway_session') {
                    return CANDIDATE_SESSION_ID;
                }
                if (command === 'provider_gateway_request') {
                    return new Promise<never>(() => undefined);
                }
                return undefined;
            });

            const configuration = setCloudProviderConfig({
                provider: 'openai',
                model: 'gpt-test',
                baseUrl: 'https://api.openai.com/v1',
                authentication: 'api-key',
                apiKey: 'sk-test-key',
            });
            const rejection = expect(configuration).rejects.toThrow('Provider adapter capability probe timed out');
            await vi.advanceTimersByTimeAsync(15_000);

            await rejection;
            expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
                sessionId: CANDIDATE_SESSION_ID,
            });
            expect(hostedLlmProviderStatusStore.value).toBeNull();
        } finally {
            timeoutSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it('leaves the previously configured runtime in place when a probe returns 401', async () => {
        await setCloudProviderConfig({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
            authentication: 'none',
            apiKey: '',
        });
        mockProviderGateway({ probeStatus: 401, probeBody: '{"error":"invalid_api_key"}' });

        await expect(
            setCloudProviderConfig({
                provider: 'openai',
                model: 'gpt-test',
                baseUrl: 'https://api.openai.com/v1',
                authentication: 'api-key',
                apiKey: 'asdfasdf',
            })
        ).rejects.toThrow('Provider adapter capability probe failed with status 401');

        expect(getCloudProviderRuntime()).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            base_url: 'http://localhost:1234/v1',
            authentication: 'none',
            adapter: null,
            session_id: null,
        });
        expect(hostedLlmProviderStatusStore.value).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
            authentication: 'none',
        });
        expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: SESSION_ID,
        });
    });

    it('rejects an Anthropic 401 probe and leaves the provider unconfigured', async () => {
        mockProviderGateway({ probeStatus: 401, probeBody: '{"type":"error"}' });

        await expect(
            setCloudProviderConfig({
                provider: 'anthropic',
                model: 'claude-test',
                authentication: 'api-key',
                apiKey: 'asdfasdf',
            })
        ).rejects.toThrow('Provider adapter capability probe failed with status 401');

        expect(getCloudProviderRuntime()).toBeNull();
        expect(hostedLlmProviderStatusStore.value).toBeNull();
        expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: SESSION_ID,
        });
    });

    it('configures Anthropic after a 2xx credential probe without requiring a compiled adapter model list', async () => {
        mockProviderGateway({ probeBody: '{"data":[]}' });

        await setCloudProviderConfig({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            apiKey: 'sk-anthropic-test',
        });

        expect(mocks.invoke).toHaveBeenCalledWith(
            'provider_gateway_request',
            expect.objectContaining({
                sessionId: SESSION_ID,
                operation: 'probe',
                body: null,
            })
        );
        expect(getCloudProviderRuntime()).toMatchObject({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            session_id: SESSION_ID,
        });
        expect(hostedLlmProviderStatusStore.value).toEqual({
            provider: 'anthropic',
            model: 'claude-test',
            baseUrl: null,
            authentication: 'api-key',
        });
        expect(isCloudAvailable()).toBe(true);
    });

    it('revokes active requests and closes the old session during replacement', async () => {
        await setCloudProviderConfig({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            apiKey: 'sk-anthropic-test',
        });
        const activeRequest = registerCloudStreamController(new AbortController());

        await setCloudProviderConfig({
            provider: 'openai-compatible',
            model: 'local',
            baseUrl: 'http://localhost:1234/v1',
            authentication: 'none',
            apiKey: '',
        });

        expect(activeRequest.signal.aborted).toBe(true);
        expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: SESSION_ID,
        });
    });

    it('closes a candidate session when replacing the active session fails', async () => {
        await setCloudProviderConfig({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            apiKey: 'sk-anthropic-test',
        });
        mocks.invoke.mockImplementation(async (command, args) => {
            if (command === 'open_provider_gateway_session') {
                return CANDIDATE_SESSION_ID;
            }
            if (command === 'provider_gateway_request') {
                const channelValue = args?.onEvent;
                if (
                    typeof channelValue !== 'object' ||
                    channelValue === null ||
                    !('onmessage' in channelValue) ||
                    typeof channelValue.onmessage !== 'function'
                ) {
                    throw new Error('Expected a provider gateway event channel');
                }
                emitProbeResponse(
                    channelValue as TestGatewayChannel,
                    args?.requestId,
                    200,
                    '{"data":[{"id":"gpt-test"}]}'
                );
                return undefined;
            }
            if (command === 'close_provider_gateway_session' && args?.sessionId === SESSION_ID) {
                throw new Error('close failed');
            }
            return undefined;
        });

        try {
            await expect(
                setCloudProviderConfig({
                    provider: 'openai',
                    model: 'gpt-test',
                    baseUrl: 'https://api.openai.com/v1',
                    authentication: 'api-key',
                    apiKey: 'sk-openai-test',
                })
            ).rejects.toThrow('close failed');
            expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
                sessionId: CANDIDATE_SESSION_ID,
            });
        } finally {
            mockProviderGateway({ sessionId: SESSION_ID });
            await clearCloudProviderConfig();
        }
    });

    it('rejects hosted configuration outside the desktop shell', async () => {
        mocks.isDesktopRuntime.mockReturnValue(false);
        await expect(
            setCloudProviderConfig({
                provider: 'anthropic',
                model: 'claude-test',
                authentication: 'api-key',
                apiKey: 'sk-anthropic-test',
            })
        ).rejects.toThrow('desktop builds only');
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('opens a native session with the exact key for HTTPS compatible providers', async () => {
        await setCloudProviderConfig({
            provider: 'openai-compatible',
            model: 'custom-model',
            baseUrl: 'https://models.example.test/v1',
            authentication: 'api-key',
            apiKey: '  compatible-key  ',
        });

        expect(mocks.invoke).toHaveBeenCalledWith('open_provider_gateway_session', {
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            origin: 'https://models.example.test',
            credentialSource: 'openai-compatible',
            credential: '  compatible-key  ',
        });
        expect(hostedLlmProviderStatusStore.value).toEqual({
            provider: 'openai-compatible',
            model: 'custom-model',
            baseUrl: 'https://models.example.test/v1',
            authentication: 'api-key',
        });
    });

    it('rejects credentialed loopback configuration without opening a session', async () => {
        await expect(
            setCloudProviderConfig({
                provider: 'openai-compatible',
                model: 'qwen-local',
                baseUrl: 'http://localhost:1234/v1',
                authentication: 'api-key',
                apiKey: 'local-key',
            })
        ).rejects.toThrow('Authenticated OpenAI-compatible providers require HTTPS');
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it('installs the later Connect and closes the superseded candidate when probes overlap', async () => {
        let releaseFirstProbe!: () => void;
        const firstProbeReleased = new Promise<void>((resolve) => {
            releaseFirstProbe = resolve;
        });
        let notifyFirstProbeStarted!: () => void;
        const firstProbeStarted = new Promise<void>((resolve) => {
            notifyFirstProbeStarted = resolve;
        });
        let openCount = 0;

        mocks.invoke.mockImplementation(async (command, args) => {
            if (command === 'open_provider_gateway_session') {
                openCount += 1;
                if (openCount === 1) {
                    return SESSION_ID;
                }
                return CANDIDATE_SESSION_ID;
            }
            if (command === 'provider_gateway_request') {
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
                if (args?.sessionId === SESSION_ID) {
                    notifyFirstProbeStarted();
                    await firstProbeReleased;
                    emitProbeResponse(channel, args?.requestId, 200, DEFAULT_PROBE_BODY);
                    return undefined;
                }
                emitProbeResponse(channel, args?.requestId, 200, '{"data":[]}');
                return undefined;
            }
            return undefined;
        });

        const firstConnect = setCloudProviderConfig({
            provider: 'openai',
            model: 'gpt-test',
            baseUrl: 'https://api.openai.com/v1',
            authentication: 'api-key',
            apiKey: 'sk-first',
        });
        await firstProbeStarted;
        const firstRejection = expect(firstConnect).rejects.toThrow('Cloud credential replacement was superseded');

        await setCloudProviderConfig({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            apiKey: 'sk-second',
        });
        releaseFirstProbe();
        await firstRejection;

        expect(getCloudProviderRuntime()).toMatchObject({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            session_id: CANDIDATE_SESSION_ID,
        });
        expect(hostedLlmProviderStatusStore.value).toEqual({
            provider: 'anthropic',
            model: 'claude-test',
            baseUrl: null,
            authentication: 'api-key',
        });
        expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: SESSION_ID,
        });
        expect(mocks.invoke).not.toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: CANDIDATE_SESSION_ID,
        });
    });
});
