import { describe, it, expect, vi } from 'vitest';
import { isCloudAvailable } from '../isCloudAvailable';

const mocks = vi.hoisted(() => ({
    isCloudAvailable: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/keyManagement', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

describe('isCloudAvailable (use case)', () => {
    it('returns true if the repository says cloud is available', () => {
        mocks.isCloudAvailable.mockReturnValue(true);
        expect(isCloudAvailable()).toBe(true);
    });

    it('returns false if the repository says cloud is unavailable', () => {
        mocks.isCloudAvailable.mockReturnValue(false);
        expect(isCloudAvailable()).toBe(false);
    });
});
