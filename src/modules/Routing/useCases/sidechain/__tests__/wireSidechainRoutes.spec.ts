import { describe, it, expect, vi, beforeEach } from 'vitest';

import { wireSidechainRoutes } from '../wireSidechainRoutes';

import type { SidechainRoute } from '../../../models/SidechainRoute';

const mocks = vi.hoisted(() => ({
    wireSidechainRoute: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    wireSidechainRoute: mocks.wireSidechainRoute,
}));

const mockStoreValue: { value: unknown } = { value: null };

vi.mock('../../../stores/sidechainStore', () => ({
    sidechainStore: {
        get value() {
            return mockStoreValue.value;
        },
    },
}));

function route(partial: Partial<SidechainRoute>): SidechainRoute {
    return {
        id: 'r1',
        sourceTrackId: 'src',
        targetTrackId: 'dst',
        targetDeviceId: 'dev1',
        targetParameterId: 'threshold',
        gain: 1,
        ...partial,
    };
}

describe('wireSidechainRoutes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStoreValue.value = null;
    });

    it('wires every persisted route into the engine', () => {
        mockStoreValue.value = {
            routes: [
                route({ sourceTrackId: 'a', targetTrackId: 'b', targetDeviceId: 'devA' }),
                route({ sourceTrackId: 'c', targetTrackId: 'd', targetDeviceId: 'devB' }),
            ],
        };

        wireSidechainRoutes();

        expect(mocks.wireSidechainRoute).toHaveBeenCalledTimes(2);
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('a', 'b', 'devA');
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('c', 'd', 'devB');
    });

    it('does not mutate or wire when the store is unhydrated', () => {
        mockStoreValue.value = null;

        wireSidechainRoutes();

        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
    });

    it('is a no-op when there are no persisted routes', () => {
        mockStoreValue.value = { routes: [] };

        wireSidechainRoutes();

        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
    });
});
