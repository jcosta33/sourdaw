import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hostedLlmProviderStatusStore } from '../../../stores/hostedLlmProviderStatusStore';
import { clearCloudProviderConfig } from '../clearCloudProviderConfig';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';
import { isCloudAvailable } from '../isCloudAvailable';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { setCloudProviderConfig } from '../setCloudProviderConfig';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    isDesktopRuntime: vi.fn(() => true),
    info: vi.fn(),
}));

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: mocks.isDesktopRuntime,
    desktopInvoke: mocks.invoke,
    createChannel: vi.fn(),
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { info: mocks.info } }));

describe('setCloudProviderConfig', () => {
    beforeEach(async () => {
        await clearCloudProviderConfig();
        vi.clearAllMocks();
        mocks.isDesktopRuntime.mockReturnValue(true);
        mocks.invoke.mockImplementation(async (command) =>
            command === 'open_provider_gateway_session'
                ? 'provider-session-00000000000000000000000000000000'
                : undefined
        );
    });

    it('keeps an unauthenticated loopback provider renderer-local', async () => {
        await setCloudProviderConfig({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
        });

        expect(getCloudProviderRuntime()).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            base_url: 'http://localhost:1234/v1',
            adapter: null,
            session_id: null,
        });
        expect(mocks.invoke).not.toHaveBeenCalledWith('open_provider_gateway_session', expect.anything());
        expect(hostedLlmProviderStatusStore.value).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
        });
    });

    it('opens an opaque native session for remote providers', async () => {
        await setCloudProviderConfig({
            provider: 'openai',
            model: 'gpt-test',
            baseUrl: 'https://api.openai.com/v1',
        });

        expect(mocks.invoke).toHaveBeenCalledWith('open_provider_gateway_session', {
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            origin: 'https://api.openai.com',
            credentialSource: 'openai',
        });
        expect(getCloudProviderRuntime()).toMatchObject({
            provider: 'openai',
            model: 'gpt-test',
            session_id: 'provider-session-00000000000000000000000000000000',
        });
        expect(isCloudAvailable()).toBe(true);
    });

    it('revokes active requests and closes the old session during replacement', async () => {
        await setCloudProviderConfig({
            provider: 'anthropic',
            model: 'claude-test',
        });
        const activeRequest = registerCloudStreamController(new AbortController());

        await setCloudProviderConfig({
            provider: 'openai-compatible',
            model: 'local',
            baseUrl: 'http://localhost:1234/v1',
        });

        expect(activeRequest.signal.aborted).toBe(true);
        expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: 'provider-session-00000000000000000000000000000000',
        });
    });

    it('closes a candidate session when replacing the active session fails', async () => {
        const previousSessionId = 'provider-session-00000000000000000000000000000000';
        const candidateSessionId = 'provider-session-11111111111111111111111111111111';
        await setCloudProviderConfig({ provider: 'anthropic', model: 'claude-test' });
        mocks.invoke.mockImplementation(async (command, args) => {
            if (command === 'open_provider_gateway_session') {
                return candidateSessionId;
            }
            if (command === 'close_provider_gateway_session' && args?.sessionId === previousSessionId) {
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
                })
            ).rejects.toThrow('close failed');
            expect(mocks.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
                sessionId: candidateSessionId,
            });
        } finally {
            mocks.invoke.mockImplementation(async (command) =>
                command === 'open_provider_gateway_session' ? previousSessionId : undefined
            );
            await clearCloudProviderConfig();
        }
    });

    it('rejects hosted configuration outside the desktop shell', async () => {
        mocks.isDesktopRuntime.mockReturnValue(false);
        await expect(setCloudProviderConfig({ provider: 'anthropic', model: 'claude-test' })).rejects.toThrow(
            'desktop builds only'
        );
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});
