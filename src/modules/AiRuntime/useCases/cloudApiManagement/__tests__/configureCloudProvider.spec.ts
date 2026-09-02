import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureCloudProvider } from '../configureCloudProvider';

const mocks = vi.hoisted(() => {
    const llmStatusValue: { value: Record<string, unknown> } = { value: { state: 'idle' } };
    return {
        setCloudProviderConfig: vi.fn(async () => undefined),
        llmStatusSet: vi.fn(),
        llmStatusValue,
    };
});

vi.mock('../../../repositories/cloudLlm/setCloudProviderConfig', () => ({
    setCloudProviderConfig: mocks.setCloudProviderConfig,
}));
vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: {
        get value() {
            return mocks.llmStatusValue.value;
        },
        set: mocks.llmStatusSet,
    },
}));

describe('configureCloudProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.llmStatusValue.value = { state: 'idle' };
    });

    it('normalizes models and fixed provider origins without altering the API key', async () => {
        await configureCloudProvider({
            provider: 'openai',
            model: '  gpt-test  ',
            authentication: 'api-key',
            apiKey: '  sk-test-key  ',
        });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith({
            provider: 'openai',
            model: 'gpt-test',
            baseUrl: 'https://api.openai.com/v1',
            authentication: 'api-key',
            apiKey: '  sk-test-key  ',
        });
    });

    it('accepts an unauthenticated loopback compatible endpoint', async () => {
        await configureCloudProvider({
            provider: 'openai-compatible',
            model: 'qwen',
            baseUrl: 'http://localhost:1234/v1/',
            authentication: 'none',
            apiKey: '',
        });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: 'http://localhost:1234/v1' })
        );
    });

    it('rejects IPv6 loopback provider URLs', async () => {
        await expect(
            configureCloudProvider({
                provider: 'openai-compatible',
                model: 'qwen',
                baseUrl: 'http://[::1]:11434/v1',
                authentication: 'none',
                apiKey: '',
            })
        ).rejects.toThrow('Provider base URL must use HTTPS or loopback HTTP');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('forwards an authenticated HTTPS compatible configuration with its normalized base URL', async () => {
        await configureCloudProvider({
            provider: 'openai-compatible',
            model: 'custom-model',
            baseUrl: ' https://models.example.test/v1/ ',
            authentication: 'api-key',
            apiKey: '  compatible-key  ',
        });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith({
            provider: 'openai-compatible',
            model: 'custom-model',
            baseUrl: 'https://models.example.test/v1',
            authentication: 'api-key',
            apiKey: '  compatible-key  ',
        });
    });

    it('invalidates cloud readiness after reconfiguration', async () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'cloud', modelId: 'old-model' };

        await configureCloudProvider({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            apiKey: 'sk-anthropic-test',
        });

        expect(mocks.llmStatusSet).toHaveBeenCalledWith({ state: 'idle' });
    });

    it('rejects empty models and insecure remote endpoints', async () => {
        await expect(
            configureCloudProvider({
                provider: 'openai',
                model: ' ',
                authentication: 'api-key',
                apiKey: 'sk-openai-test',
            })
        ).rejects.toThrow('Model cannot be empty');
        await expect(
            configureCloudProvider({
                provider: 'openai-compatible',
                model: 'model',
                baseUrl: 'http://example.com/v1',
                authentication: 'none',
                apiKey: '',
            })
        ).rejects.toThrow('Provider base URL must use HTTPS or loopback HTTP');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('rejects endpoint credentials, queries, and fragments', async () => {
        for (const baseUrl of [
            'https://user:password@example.com/v1',
            'https://example.com/v1?token=secret',
            'https://example.com/v1#provider',
        ]) {
            await expect(
                configureCloudProvider({
                    provider: 'openai-compatible',
                    model: 'model',
                    baseUrl,
                    authentication: 'none',
                    apiKey: '',
                })
            ).rejects.toThrow('Provider base URL cannot include credentials, a query, or a fragment');
        }
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('requires a nonblank first-party API key without persisting it', async () => {
        await expect(
            configureCloudProvider({
                provider: 'anthropic',
                model: 'claude-test',
                authentication: 'api-key',
                apiKey: '  ',
            })
        ).rejects.toThrow('Anthropic API key is required');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('rejects a blank OpenAI API key before repository configuration', async () => {
        await expect(
            configureCloudProvider({ provider: 'openai', model: 'gpt-test', authentication: 'api-key', apiKey: '  ' })
        ).rejects.toThrow('OpenAI API key is required');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('rejects a key when compatible authentication is explicitly disabled', async () => {
        await expect(
            configureCloudProvider({
                provider: 'openai-compatible',
                model: 'qwen',
                baseUrl: 'http://localhost:1234/v1',
                authentication: 'none',
                apiKey: 'must-not-be-forwarded',
            })
        ).rejects.toThrow('Remove the API key before connecting without authentication');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated public HTTPS compatible configuration before repository setup', async () => {
        await expect(
            configureCloudProvider({
                provider: 'openai-compatible',
                model: 'qwen',
                baseUrl: 'https://models.example.test/v1',
                authentication: 'none',
                apiKey: '',
            })
        ).rejects.toThrow('Unauthenticated OpenAI-compatible providers require loopback HTTP');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('rejects credentialed loopback providers while preserving unauthenticated loopback', async () => {
        await expect(
            configureCloudProvider({
                provider: 'openai-compatible',
                model: 'qwen',
                baseUrl: 'http://localhost:1234/v1',
                authentication: 'api-key',
                apiKey: 'local-key',
            })
        ).rejects.toThrow('Authenticated OpenAI-compatible providers require HTTPS');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });
});
