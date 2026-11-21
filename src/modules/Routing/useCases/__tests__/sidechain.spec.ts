import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SidechainCycleError } from '../../errors/RoutingErrors';
import { addSidechainRoute } from '../sidechain/addSidechainRoute';
import { getAllSidechainRoutes } from '../sidechain/getAllSidechainRoutes';
import { getSidechainRoutesForTrack } from '../sidechain/getSidechainRoutesForTrack';
import { removeSidechainRoute } from '../sidechain/removeSidechainRoute';
import { setSidechainRoutes } from '../sidechain/setSidechainRoutes';

const mocks = vi.hoisted(() => ({
    tracks: [] as Array<{ id: string; kind: string }>,
    wireSidechainRoute: vi.fn<(...args: unknown[]) => unknown>(),
    unwireSidechainRoute: vi.fn<(...args: unknown[]) => unknown>(),
    createSidechainRoute: vi.fn(
        (sourceTrackId: string, targetTrackId: string, targetDeviceId: string, targetParameterId: string) => ({
            id: 'r1',
            sourceTrackId,
            targetTrackId,
            targetDeviceId,
            targetParameterId,
        })
    ),
    storeSet: vi.fn((next: unknown) => {
        mockStoreValue.value = next;
    }),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return { tracks: mocks.tracks };
        },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    wireSidechainRoute: mocks.wireSidechainRoute,
    unwireSidechainRoute: mocks.unwireSidechainRoute,
    getEngineState: vi.fn(() => ({ isReady: false })),
}));

vi.mock('../../models/SidechainRoute', () => ({
    createSidechainRoute: mocks.createSidechainRoute,
}));

let mockStoreValue: { value: unknown } = { value: null };

vi.mock('../../stores/sidechainStore', () => ({
    sidechainStore: {
        get value() {
            return mockStoreValue.value;
        },
        set: mocks.storeSet,
    },
}));

function scRoute(id: string, sourceTrackId: string, targetTrackId: string, targetDeviceId: string) {
    return { id, sourceTrackId, targetTrackId, targetDeviceId, targetParameterId: 'threshold' };
}

describe('sidechain use cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tracks = ['src', 'dst', 't1', 'a', 'c', 'z', 'd'].map((id) => ({ id, kind: 'audio' }));
        mockStoreValue.value = { routes: [] };
    });

    it('addSidechainRoute creates and wires a new route', () => {
        const didWrite = addSidechainRoute('src', 'dst', 'dev1');

        expect(mocks.createSidechainRoute).toHaveBeenCalledWith('src', 'dst', 'dev1', 'threshold');
        expect(mocks.storeSet).toHaveBeenCalled();
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('src', 'dst', 'dev1');
        expect(didWrite).toBe(true);
    });

    it('addSidechainRoute throws on self-routing cycle', () => {
        expect(() => addSidechainRoute('t1', 't1', 'dev1')).toThrow(SidechainCycleError);
    });

    it('addSidechainRoute throws on a transitive (multi-hop) cycle', () => {
        // Existing routes form a path c -> b -> a. Adding a -> c closes the loop:
        // the BFS walks forward from the new target (c) and reaches the new
        // source (a) two hops away, so it must reject before mutating the store.
        mockStoreValue.value = {
            routes: [
                {
                    id: 'r1',
                    sourceTrackId: 'c',
                    targetTrackId: 'b',
                    targetDeviceId: 'devC',
                    targetParameterId: 'threshold',
                },
                {
                    id: 'r2',
                    sourceTrackId: 'b',
                    targetTrackId: 'a',
                    targetDeviceId: 'devB',
                    targetParameterId: 'threshold',
                },
            ],
        };

        expect(() => addSidechainRoute('a', 'c', 'dev1')).toThrow(SidechainCycleError);
        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
    });

    it('addSidechainRoute does not falsely detect a cycle when a node is reachable via two paths', () => {
        // d branches into b and c, which both converge back on e. The BFS
        // must revisit e (already visited via b) without looping forever or
        // misreporting a cycle, since e never leads back to the new source.
        mockStoreValue.value = {
            routes: [
                scRoute('r1', 'd', 'b', 'devD1'),
                scRoute('r2', 'd', 'c', 'devD2'),
                scRoute('r3', 'b', 'e', 'devB'),
                scRoute('r4', 'c', 'e', 'devC'),
            ],
        };

        const didWrite = addSidechainRoute('z', 'd', 'devZ');
        expect(mocks.createSidechainRoute).toHaveBeenCalledWith('z', 'd', 'devZ', 'threshold');
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('z', 'd', 'devZ');
        expect(didWrite).toBe(true);
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

        const didWrite = addSidechainRoute('src', 'dst', 'dev1');

        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('addSidechainRoute is a no-op when the store has no value', () => {
        mockStoreValue.value = null;

        const didWrite = addSidechainRoute('src', 'dst', 'dev1');

        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
        expect(mocks.createSidechainRoute).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
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

    it('can defer the runtime unwire until after the owning transaction commits', () => {
        const route = {
            id: 'r1',
            sourceTrackId: 'src',
            targetTrackId: 'dst',
            targetDeviceId: 'dev1',
            targetParameterId: 'threshold',
        };
        mockStoreValue.value = { routes: [route] };

        const afterCommit = removeSidechainRoute('r1', { deferRuntimeEffect: true });

        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [] });
        expect(mocks.unwireSidechainRoute).not.toHaveBeenCalled();

        afterCommit?.();

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('src', 'dev1');
    });

    it('removeSidechainRoute is a no-op when the route id is not found', () => {
        const route = {
            id: 'r1',
            sourceTrackId: 'src',
            targetTrackId: 'dst',
            targetDeviceId: 'dev1',
            targetParameterId: 'threshold',
        };
        mockStoreValue.value = { routes: [route] };

        removeSidechainRoute('does-not-exist');

        expect(mocks.unwireSidechainRoute).not.toHaveBeenCalled();
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [route] });
    });

    it('removeSidechainRoute is a no-op when the store has no value', () => {
        mockStoreValue.value = null;

        removeSidechainRoute('r1');

        expect(mocks.unwireSidechainRoute).not.toHaveBeenCalled();
        expect(mocks.storeSet).not.toHaveBeenCalled();
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

        setSidechainRoutes([newRoute] as unknown as Parameters<typeof setSidechainRoutes>[0]);

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('a', 'devA');
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [newRoute] });
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('c', 'd', 'devB');
    });

    it('setSidechainRoutes only wires new routes when there is no prior store state to unwire', () => {
        mockStoreValue.value = null;
        const newRoute = {
            id: 'r2',
            sourceTrackId: 'c',
            targetTrackId: 'd',
            targetDeviceId: 'devB',
            targetParameterId: 'threshold',
        };

        setSidechainRoutes([newRoute] as unknown as Parameters<typeof setSidechainRoutes>[0]);

        expect(mocks.unwireSidechainRoute).not.toHaveBeenCalled();
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [newRoute] });
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('c', 'd', 'devB');
    });

    it('getSidechainRoutesForTrack and getAllSidechainRoutes read raw store', () => {
        mockStoreValue.value = null;
        // Sanity-check they don't throw on a missing store value.
        expect(getSidechainRoutesForTrack('nope')).toEqual([]);
        expect(getAllSidechainRoutes()).toEqual([]);
    });

    it('getSidechainRoutesForTrack filters by source or target track id', () => {
        const asSource = {
            id: 'r1',
            sourceTrackId: 'trackA',
            targetTrackId: 'trackB',
            targetDeviceId: 'dev1',
            targetParameterId: 'threshold',
        };
        const asTarget = {
            id: 'r2',
            sourceTrackId: 'trackC',
            targetTrackId: 'trackA',
            targetDeviceId: 'dev2',
            targetParameterId: 'threshold',
        };
        const unrelated = {
            id: 'r3',
            sourceTrackId: 'trackC',
            targetTrackId: 'trackD',
            targetDeviceId: 'dev3',
            targetParameterId: 'threshold',
        };
        mockStoreValue.value = { routes: [asSource, asTarget, unrelated] };

        expect(getSidechainRoutesForTrack('trackA')).toEqual([asSource, asTarget]);
        expect(getSidechainRoutesForTrack('trackD')).toEqual([unrelated]);
        expect(getSidechainRoutesForTrack('trackZ')).toEqual([]);
    });
});
