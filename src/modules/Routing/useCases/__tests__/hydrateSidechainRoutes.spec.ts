import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/sidechainStore', () => ({
    sidechainStore: { hydrate: vi.fn() },
}));

import { sidechainStore } from '../../stores/sidechainStore';
import { hydrateSidechainRoutes } from '../hydrateSidechainRoutes';

describe('hydrateSidechainRoutes', () => {
    beforeEach(() => {
        vi.mocked(sidechainStore.hydrate).mockClear();
    });

    it('delegates to sidechainStore.hydrate', () => {
        hydrateSidechainRoutes();
        expect(sidechainStore.hydrate).toHaveBeenCalledTimes(1);
    });
});
