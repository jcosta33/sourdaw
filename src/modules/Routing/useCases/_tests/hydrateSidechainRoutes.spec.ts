import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/sidechainStore', () => ({
    sidechainStore: { hydrate: vi.fn() },
}));

import { hydrateSidechainRoutes } from '../hydrateSidechainRoutes';
import { sidechainStore } from '../../stores/sidechainStore';

describe('hydrateSidechainRoutes', () => {
    beforeEach(() => {
        vi.mocked(sidechainStore.hydrate).mockClear();
    });

    it('delegates to sidechainStore.hydrate', () => {
        hydrateSidechainRoutes();
        expect(sidechainStore.hydrate).toHaveBeenCalledTimes(1);
    });
});
