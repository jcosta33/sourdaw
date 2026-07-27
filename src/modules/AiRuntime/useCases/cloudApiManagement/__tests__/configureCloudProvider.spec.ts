import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureCloudProvider } from '../configureCloudProvider';

const mocks = vi.hoisted(() => {
    const llmStatusValue: { value: Record<string, unknown> } = { value: { state: 'idle' } };
    return {
        setCloudProviderConfig: vi.fn(),
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

    it('allows an auth-free OpenAI-compatible endpoint', () => {
        configureCloudProvider({
            provider: 'openai-compatible',
            apiKey: ' ',
            model: 'qwen',
            baseUrl: 'http://localhost:1234/v1',
        });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith({
            provider: 'openai-compatible',
            apiKey: '',
            model: 'qwen',
            baseUrl: 'http://localhost:1234/v1',
        });
    });

    it('invalidates cloud readiness after reconfiguration', () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'cloud', modelId: 'old-model' };

        configureCloudProvider({
            provider: 'openai',
            apiKey: 'key',
            model: 'new-model',
        });

        expect(mocks.llmStatusSet).toHaveBeenCalledWith({ state: 'idle' });
    });

    it('normalizes the OpenAI preset without persisting credentials', () => {
        configureCloudProvider({
            provider: 'openai',
            apiKey: '  sk-openai  ',
            model: '  gpt-5.2  ',
        });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith({
            provider: 'openai',
            apiKey: 'sk-openai',
            model: 'gpt-5.2',
            baseUrl: 'https://api.openai.com/v1',
        });
    });

    it('accepts HTTPS and loopback HTTP compatible endpoints', () => {
        configureCloudProvider({
            provider: 'openai-compatible',
            apiKey: 'local',
            model: 'qwen',
            baseUrl: 'http://localhost:1234/v1/',
        });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: 'http://localhost:1234/v1' })
        );
    });

    it('rejects empty credentials, empty models, and insecure remote endpoints', () => {
        expect(() =>
            configureCloudProvider({ provider: 'anthropic', apiKey: ' ', model: 'claude-sonnet-4-20250514' })
        ).toThrow('API key cannot be empty');
        expect(() => configureCloudProvider({ provider: 'openai', apiKey: 'key', model: ' ' })).toThrow(
            'Model cannot be empty'
        );
        expect(() =>
            configureCloudProvider({
                provider: 'openai-compatible',
                apiKey: 'key',
                model: 'model',
                baseUrl: 'http://example.com/v1',
            })
        ).toThrow('Provider base URL must use HTTPS or loopback HTTP');
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });

    it('rejects compatible endpoints containing URL credentials, queries, or fragments', () => {
        for (const baseUrl of [
            'https://user:password@example.com/v1',
            'https://example.com/v1?token=secret',
            'https://example.com/v1#provider',
        ]) {
            expect(() =>
                configureCloudProvider({
                    provider: 'openai-compatible',
                    apiKey: 'key',
                    model: 'model',
                    baseUrl,
                })
            ).toThrow('Provider base URL cannot include credentials, a query, or a fragment');
        }

        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });
});
