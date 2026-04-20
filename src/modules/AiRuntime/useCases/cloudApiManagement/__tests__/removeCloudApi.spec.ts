import { describe, it, expect, vi } from 'vitest';

import { removeCloudApi } from '../removeCloudApi';

const mocks = vi.hoisted(() => ({
    clearCloudApiKey: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/keyManagement', () => ({
    clearCloudApiKey: mocks.clearCloudApiKey,
}));

describe('removeCloudApi', () => {
    it('calls clearCloudApiKey from the repository', () => {
        removeCloudApi();
        expect(mocks.clearCloudApiKey).toHaveBeenCalledTimes(1);
    });
});
