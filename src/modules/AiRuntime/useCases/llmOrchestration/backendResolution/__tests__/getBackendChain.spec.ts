import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getBackendChain } from '../getBackendChain';

const mocks = vi.hoisted(() => ({
    resolveBackend: vi.fn(),
    isCloudAvailable: vi.fn(),
}));

vi.mock('../helpers', () => ({
    resolveBackend: mocks.resolveBackend,
}));

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

describe('getBackendChain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns native followed by cloud if native is primary and cloud is available', () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.isCloudAvailable.mockReturnValue(true);

        expect(getBackendChain()).toEqual(['native', 'cloud']);
    });

    it('returns webllm followed by cloud if webllm is primary and cloud is available', () => {
        mocks.resolveBackend.mockReturnValue('webllm');
        mocks.isCloudAvailable.mockReturnValue(true);

        expect(getBackendChain()).toEqual(['webllm', 'cloud']);
    });

    it('returns only primary if cloud is unavailable', () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.isCloudAvailable.mockReturnValue(false);

        expect(getBackendChain()).toEqual(['native']);
    });

    it('returns only cloud if primary is none but cloud is available (edge case)', () => {
        mocks.resolveBackend.mockReturnValue('none');
        mocks.isCloudAvailable.mockReturnValue(true);

        expect(getBackendChain()).toEqual(['cloud']);
    });

    it('returns empty array if no backend is available', () => {
        mocks.resolveBackend.mockReturnValue('none');
        mocks.isCloudAvailable.mockReturnValue(false);

        expect(getBackendChain()).toEqual([]);
    });
});
