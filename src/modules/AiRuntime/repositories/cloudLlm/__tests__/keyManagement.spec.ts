import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    setCloudApiKey,
    clearCloudApiKey,
    isCloudAvailable,
    registerCloudStreamController,
    unregisterCloudStreamController,
} from '../keyManagement';

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

describe('clearCloudApiKey stream-controller revocation', () => {
    beforeEach(() => {
        clearCloudApiKey();
        vi.clearAllMocks();
    });

    it('aborts every registered in-flight stream controller when the key is cleared', () => {
        // Regression: clearing the key nulled the client synchronously but did
        // not interrupt in-flight stream readers, so a revoked key kept being
        // used until each SSE stream closed on its own (a security gap).
        const a = registerCloudStreamController(new AbortController());
        const b = registerCloudStreamController(new AbortController());

        expect(a.signal.aborted).toBe(false);
        expect(b.signal.aborted).toBe(false);

        clearCloudApiKey();

        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(true);
    });

    it('does not abort a controller that already unregistered (stream settled)', () => {
        const settled = registerCloudStreamController(new AbortController());
        unregisterCloudStreamController(settled);

        clearCloudApiKey();

        expect(settled.signal.aborted).toBe(false);
    });
});
