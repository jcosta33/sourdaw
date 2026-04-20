import { describe, it, expect, vi, beforeEach } from 'vitest';

import { configureCloudApi } from '../configureCloudApi';

const mocks = vi.hoisted(() => ({
    setCloudApiKey: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/keyManagement', () => ({
    setCloudApiKey: mocks.setCloudApiKey,
}));

describe('configureCloudApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('trims the API key and passes it to setCloudApiKey', () => {
        configureCloudApi('  sk-test-key  ');
        expect(mocks.setCloudApiKey).toHaveBeenCalledWith('sk-test-key');
        expect(mocks.setCloudApiKey).toHaveBeenCalledTimes(1);
    });

    it('throws an AiRuntimeError if the API key is empty', () => {
        expect(() => configureCloudApi('')).toThrow('API key cannot be empty');
        expect(() => configureCloudApi('   ')).toThrow('API key cannot be empty');
        expect(mocks.setCloudApiKey).not.toHaveBeenCalled();
    });
});
