import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SidechainCycleError } from '../../errors/RoutingErrors';
import { addSidechainRoute } from '../sidechain/addSidechainRoute';
import { getAllSidechainRoutes } from '../sidechain/getAllSidechainRoutes';
import { getSidechainRoutesForTrack } from '../sidechain/getSidechainRoutesForTrack';
import { getSidechainSource } from '../sidechain/getSidechainSource';
import { removeSidechainRoute } from '../sidechain/removeSidechainRoute';
import { setSidechainRoutes } from '../sidechain/setSidechainRoutes';

const mocks = vi.hoisted(() => ({
    wireSidechainRoute: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    createSidechainRoute: vi.fn((sourceTrackId, targetTrackId, targetDeviceId, targetParameterId) => ({
        id: 'r1',
        sourceTrackId,
        targetTrackId,
        targetDeviceId,
        targetParameterId,
    })),
    storeSet: vi.fn((next: any) => {
        mockStoreValue.value = next;
    }),
}));

vi.mock('#/modules/AudioEngine/useCases/engineAccess/wireSidechainRoute', () => ({
    wireSidechainRoute: mocks.wireSidechainRoute,
}));
vi.mock('#/modules/AudioEngine/useCases/engineAccess/unwireSidechainRoute', () => ({
    unwireSidechainRoute: mocks.unwireSidechainRoute,
}));

vi.mock('../../models/SidechainRoute', () => ({
    createSidechainRoute: mocks.createSidechainRoute,
}));

let mockStoreValue: { value: any } = { value: null };

vi.mock('../../stores/sidechainStore', () => ({
    sidechainStore: {
        get value() {
            return mockStoreValue.value;
        },
        set: mocks.storeSet,
    },
}));

describe('sidechain use cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStoreValue.value = { routes: [] };
    });

    it('addSidechainRoute creates and wires a new route', () => {
        addSidechainRoute('src', 'dst', 'dev1');

        expect(mocks.createSidechainRoute).toHaveBeenCalledWith('src', 'dst', 'dev1', 'threshold');
        expect(mocks.storeSet).toHaveBeenCalled();
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('src', 'dst', 'dev1');
    });

    it('addSidechainRoute throws on self-routing cycle', () => {
        expect(() => addSidechainRoute('t1', 't1', 'dev1')).toThrow(SidechainCycleError);
    });

    it('addSidechainRoute is idempotent for duplicates', () => {
        const existing = {
            id: 'r1',
            sourceTrackId: 'src',
            targetTrackId: 'dst',
            targetDeviceId: 'dev1',
            targetParameterId: 'threshold',
        };
        mockStoreValue.value = { routes: [existing] };

        addSidechainRoute('src', 'dst', 'dev1');

        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
    });

    it('removeSidechainRoute unwires and removes the route', () => {
        const route = {
            id: 'r1',
            sourceTrackId: 'src',
            targetTrackId: 'dst',
            targetDeviceId: 'dev1',
            targetParameterId: 'threshold',
        };
        mockStoreValue.value = { routes: [route] };

        removeSidechainRoute('r1');

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('src', 'dev1');
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [] });
    });

    it('setSidechainRoutes replaces all routes (unwire old, wire new)', () => {
        const oldRoute = {
            id: 'r1',
            sourceTrackId: 'a',
            targetTrackId: 'b',
            targetDeviceId: 'devA',
            targetParameterId: 'threshold',
        };
        const newRoute = {
            id: 'r2',
            sourceTrackId: 'c',
            targetTrackId: 'd',
            targetDeviceId: 'devB',
            targetParameterId: 'threshold',
        };
        mockStoreValue.value = { routes: [oldRoute] };

        setSidechainRoutes([newRoute] as any);

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('a', 'devA');
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [newRoute] });
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('c', 'd', 'devB');
    });

    it('getSidechainRoutesForTrack and getSidechainSource read raw store', () => {
        mockStoreValue.value = null;
        // Sanity-check they don't throw on a missing store value.
        expect(getSidechainRoutesForTrack('nope')).toEqual([]);
        expect(getSidechainSource('nope')).toBeNull();
        expect(getAllSidechainRoutes()).toEqual([]);
    });
});
