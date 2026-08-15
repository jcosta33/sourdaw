import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hostedLlmProviderStatusStore } from '../../../stores/hostedLlmProviderStatusStore';
import { clearCloudApiKey } from '../clearCloudApiKey';
import { getCloudClient } from '../getCloudClient';
import { getCloudProviderInfo } from '../getCloudProviderInfo';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';
import { isCloudAvailable } from '../isCloudAvailable';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { setCloudProviderConfig } from '../setCloudProviderConfig';

const mockLogger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

describe('setCloudProviderConfig', () => {
    beforeEach(() => {
        clearCloudApiKey();
        vi.clearAllMocks();
    });

    it('stores OpenAI-compatible credentials only in the volatile provider runtime', () => {
        setCloudProviderConfig({
            provider: 'openai-compatible',
            apiKey: 'secret-key',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
        });

        expect(isCloudAvailable()).toBe(true);
        expect(getCloudClient()).toBeNull();
        expect(getCloudProviderRuntime()).toEqual({
            provider: 'openai-compatible',
            api_key: 'secret-key',
            model: 'qwen-local',
            base_url: 'http://localhost:1234/v1',
        });
        expect(getCloudProviderInfo()).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
        });
        expect(hostedLlmProviderStatusStore.value).toEqual({
            provider: 'openai-compatible',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
        });
        expect(JSON.stringify(hostedLlmProviderStatusStore.value)).not.toContain('secret-key');
        expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('secret-key');
    });

    it('aborts active requests before replacing the provider', () => {
        setCloudProviderConfig({
            provider: 'openai',
            apiKey: 'first',
            model: 'gpt-5.2',
            baseUrl: 'https://api.openai.com/v1',
        });
        const activeRequest = registerCloudStreamController(new AbortController());

        setCloudProviderConfig({
            provider: 'openai-compatible',
            apiKey: 'second',
            model: 'local',
            baseUrl: 'http://localhost:1234/v1',
        });

        expect(activeRequest.signal.aborted).toBe(true);
        expect(getCloudProviderInfo()?.provider).toBe('openai-compatible');
    });

    it('compiles remote HTTPS configuration into the privileged adapter contract', () => {
        setCloudProviderConfig({
            provider: 'openai-compatible',
            apiKey: 'remote-secret',
            model: 'vendor/studio-model-v1',
            baseUrl: 'https://models.example.test:8443/v1',
        });

        expect(getCloudProviderRuntime()).toMatchObject({
            provider: 'openai-compatible',
            model: 'vendor/studio-model-v1',
            adapter: {
                adapterId: 'builtin.openai-compatible.chat-completions.v1',
                providerId: 'openai-compatible',
                modelId: 'vendor/studio-model-v1',
                origin: 'https://models.example.test:8443',
                requestPath: '/v1/chat/completions',
                probePath: '/v1/models',
                transport: {
                    kind: 'privileged-origin',
                    dnsAdmission: 'public-global-only',
                    redirects: 'disabled',
                    proxy: 'disabled',
                },
            },
        });
    });
});
