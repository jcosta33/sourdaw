import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getPersistenceBackend } from '../crdtProjectLifecycle';

const mocks = vi.hoisted(() => ({
    isNativeCrdtAvailable: vi.fn(),
}));
vi.mock('../../repositories/nativeCrdtPersistence/isNativeCrdtAvailable', () => ({
    isNativeCrdtAvailable: mocks.isNativeCrdtAvailable,
}));

describe('crdtProjectLifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isNativeCrdtAvailable.mockReturnValue(false);
    });

    it('should report browser persistence when native is available but the lifecycle still uses IDB', () => {
        mocks.isNativeCrdtAvailable.mockReturnValue(true);

        expect(getPersistenceBackend()).toBe('browser');
    });
});
