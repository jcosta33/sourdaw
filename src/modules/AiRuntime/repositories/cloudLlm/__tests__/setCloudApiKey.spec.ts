import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCloudApiKey } from '../clearCloudApiKey';
import { getCloudClient } from '../getCloudClient';
import { isCloudAvailable } from '../isCloudAvailable';
import { setCloudApiKey } from '../setCloudApiKey';

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

    it('should create the cloud client, mark cloud available, and log without the key', () => {
        setCloudApiKey('sk-test-key');

        expect(getCloudClient()).not.toBeNull();
        expect(isCloudAvailable()).toBe(true);
        expect(mockLogger.info).toHaveBeenCalledWith('[Cloud AI] API key set');
        expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('sk-test-key'));
    });
});
