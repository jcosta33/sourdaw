import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sidechainStore } from '../../../stores/sidechainStore';
import { restoreSidechainRoutes } from '../restoreSidechainRoutes';

const mocks = vi.hoisted(() => ({
    wireSidechainRoutes: vi.fn(),
}));

vi.mock('../wireSidechainRoutes', () => ({
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

const restoredRoute = {
    id: 'sidechain-restored',
    sourceTrackId: 'source',
    targetTrackId: 'restored',
    targetDeviceId: 'device-a',
    targetParameterId: 'threshold',
    gain: 0.75,
};

describe('restoreSidechainRoutes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sidechainStore.set({ routes: [] });
    });

    it('restores project truth and defers live wiring when requested', () => {
        const finalizeRuntimeEffect = restoreSidechainRoutes([restoredRoute], {
            deferRuntimeEffect: true,
        });

        expect(sidechainStore.value?.routes).toEqual([restoredRoute]);
        expect(mocks.wireSidechainRoutes).not.toHaveBeenCalled();

        finalizeRuntimeEffect();

        expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
    });

    it('does not duplicate an already-restored route', () => {
        sidechainStore.set({ routes: [restoredRoute] });

        restoreSidechainRoutes([restoredRoute]);

        expect(sidechainStore.value?.routes).toEqual([restoredRoute]);
        expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
    });
});
