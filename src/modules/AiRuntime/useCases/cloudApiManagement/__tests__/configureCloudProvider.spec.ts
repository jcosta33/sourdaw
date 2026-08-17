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

    it('normalizes models and fixed provider origins', async () => {
        await configureCloudProvider({ provider: 'openai', model: '  gpt-test  ' });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith({
            provider: 'openai',
            model: 'gpt-test',
            baseUrl: 'https://api.openai.com/v1',
        });
    });

    it('accepts HTTPS and loopback compatible endpoints', async () => {
        await configureCloudProvider({
            provider: 'openai-compatible',
            model: 'qwen',
            baseUrl: 'http://localhost:1234/v1/',
        });

        expect(mocks.setCloudProviderConfig).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: 'http://localhost:1234/v1' })
        );
    });

    it('invalidates cloud readiness after reconfiguration', async () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'cloud', modelId: 'old-model' };

        await configureCloudProvider({ provider: 'anthropic', model: 'claude-test' });

        expect(mocks.llmStatusSet).toHaveBeenCalledWith({ state: 'idle' });
    });

    it('rejects empty models and insecure remote endpoints', async () => {
        await expect(configureCloudProvider({ provider: 'openai', model: ' ' })).rejects.toThrow(
            'Model cannot be empty'
        );
        await expect(
            configureCloudProvider({
                provider: 'openai-compatible',
                model: 'model',
                baseUrl: 'http://example.com/v1',
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
                configureCloudProvider({ provider: 'openai-compatible', model: 'model', baseUrl })
            ).rejects.toThrow('Provider base URL cannot include credentials, a query, or a fragment');
        }
        expect(mocks.setCloudProviderConfig).not.toHaveBeenCalled();
    });
});
