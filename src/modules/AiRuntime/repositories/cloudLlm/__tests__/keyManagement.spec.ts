import { describe, it, expect, beforeEach, vi } from 'vitest';

import { setCloudApiKey, clearCloudApiKey, isCloudAvailable } from '../keyManagement';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

describe('setCloudApiKey', () => {
    beforeEach(() => {
        clearCloudApiKey();
        vi.clearAllMocks();
    });

    it('should log when API key is set and mark cloud as available', () => {
        setCloudApiKey('sk-test-key');

        expect(mockLogger.info).toHaveBeenCalledWith('[Cloud AI] API key set');
        expect(isCloudAvailable()).toBe(true);
    });
});
