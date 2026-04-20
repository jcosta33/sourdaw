import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveBackend } from '../helpers';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    isCloudAvailable: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
}));

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/keyManagement', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

describe('backendResolution helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset navigator.gpu for tests
        (globalThis as any).navigator = {};
    });

    describe('resolveBackend', () => {
        it('returns native if running in Tauri', () => {
            mocks.isTauri.mockReturnValue(true);
            expect(resolveBackend()).toBe('native');
        });

        it('returns webllm if WebGPU is available and not in Tauri', () => {
            mocks.isTauri.mockReturnValue(false);
            (globalThis as any).navigator = { gpu: {} };

            expect(resolveBackend()).toBe('webllm');
        });

        it('returns cloud if cloud is available and others are not', () => {
            mocks.isTauri.mockReturnValue(false);
            mocks.isCloudAvailable.mockReturnValue(true);

            expect(resolveBackend()).toBe('cloud');
        });

        it('returns none if no backend is available', () => {
            mocks.isTauri.mockReturnValue(false);
            mocks.isCloudAvailable.mockReturnValue(false);

            expect(resolveBackend()).toBe('none');
        });
    });
});
