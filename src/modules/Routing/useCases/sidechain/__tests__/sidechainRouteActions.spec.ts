import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addSidechainRouteSnapshot } from '../addSidechainRouteSnapshot';
import { removeSidechainRouteSnapshot } from '../removeSidechainRouteSnapshot';

const mocks = vi.hoisted(() => ({
    tracks: [] as Array<{
        id: string;
        kind: string;
        devices: Array<{ id: string; type: string }>;
        outputId?: string;
        sends?: Array<{ busId: string }>;
    }>,
    wireSidechainRoute: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    storeSet: vi.fn((next: unknown) => {
        mockStoreValue.value = next;
    }),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: vi.fn(() => ({ acceptsRoutingEndpoint: true })),
    trackStore: {
        get value() {
            return { tracks: mocks.tracks };
        },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    wireSidechainRoute: mocks.wireSidechainRoute,
    unwireSidechainRoute: mocks.unwireSidechainRoute,
}));

let mockStoreValue: { value: unknown } = { value: null };

vi.mock('../../../stores/sidechainStore', () => ({
    sidechainStore: {
        get value() {
            return mockStoreValue.value;
        },
        set: mocks.storeSet,
    },
}));

const route = {
    id: 'route-1',
    sourceTrackId: 'source',
    targetTrackId: 'target',
    targetDeviceId: 'sidechain-device',
    targetParameterId: 'threshold',
    gain: 0.75,
};

describe('sidechain route action use cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tracks = [
            { id: 'source', kind: 'audio', devices: [] },
            {
                id: 'target',
                kind: 'audio',
                devices: [{ id: 'sidechain-device', type: 'builtin-sidechain-compressor' }],
            },
        ];
        mockStoreValue.value = { routes: [] };
    });

    it('writes the exact caller-owned route and wires only after commit', async () => {
        const result = addSidechainRouteSnapshot(route);

        expect(result.status).toBe('written');
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [route] });
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();

        await result.afterCommit?.();
        await result.afterCommit?.();

        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('source', 'target', 'sidechain-device');
        expect(mocks.wireSidechainRoute).toHaveBeenCalledTimes(1);
    });

    it('reconciles durable truth after an add instead of blindly wiring the attempted route', async () => {
        const result = addSidechainRouteSnapshot(route);
        mockStoreValue.value = { routes: [] };

        await result.afterCommit?.();

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('source', 'sidechain-device');
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
    });

    it('rejects a device not owned by the destination with the exact supported type', () => {
        mocks.tracks[1]!.devices = [{ id: 'sidechain-device', type: 'sidechain-compressor-proxy' }];

        const result = addSidechainRouteSnapshot(route);

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('rejects a route whose source endpoint is absent', () => {
        mocks.tracks = [mocks.tracks[1]!];

        const result = addSidechainRouteSnapshot(route);

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('rejects duplicate source and device keys without mutating durable truth', () => {
        mockStoreValue.value = { routes: [{ ...route, id: 'other-route' }] };

        const result = addSidechainRouteSnapshot(route);

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('rejects route ID collisions with a different snapshot', () => {
        mockStoreValue.value = { routes: [{ ...route, targetParameterId: 'ratio' }] };

        const result = addSidechainRouteSnapshot(route);

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('does not write when durable sidechain truth is unavailable', () => {
        mockStoreValue.value = null;

        const result = addSidechainRouteSnapshot(route);

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('rejects a route that would close a routing cycle', () => {
        const targetTrack = mocks.tracks[1]!;
        targetTrack.outputId = 'source';

        const result = addSidechainRouteSnapshot(route);

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('rejects a self-route before consulting graph topology', () => {
        const result = addSidechainRouteSnapshot({
            ...route,
            sourceTrackId: 'target',
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('reconciles an ambiguous add from durable truth by unwiring a rolled-back route', async () => {
        const result = addSidechainRouteSnapshot(route);
        mockStoreValue.value = { routes: [] };

        await result.afterAmbiguousCommit?.();
        await result.afterAmbiguousCommit?.();

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('source', 'sidechain-device');
        expect(mocks.unwireSidechainRoute).toHaveBeenCalledTimes(1);
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
    });

    it('removes only the exact matching route and unwires only after commit', async () => {
        mockStoreValue.value = { routes: [route] };

        const result = removeSidechainRouteSnapshot(route);

        expect(result.status).toBe('written');
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [] });
        expect(mocks.unwireSidechainRoute).not.toHaveBeenCalled();

        await result.afterCommit?.();
        await result.afterCommit?.();

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('source', 'sidechain-device');
        expect(mocks.unwireSidechainRoute).toHaveBeenCalledTimes(1);
    });

    it('reconciles durable truth after a removal instead of blindly unwiring the attempted route', async () => {
        mockStoreValue.value = { routes: [route] };
        const result = removeSidechainRouteSnapshot(route);
        mockStoreValue.value = { routes: [route] };

        await result.afterCommit?.();

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('source', 'sidechain-device');
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('source', 'target', 'sidechain-device');
    });

    it('rejects stale removal snapshots', () => {
        mockStoreValue.value = { routes: [{ ...route, gain: 1 }] };

        const result = removeSidechainRouteSnapshot(route);

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('removes an exact orphaned route after destination-device ownership is lost', () => {
        mocks.tracks[1]!.devices = [{ id: 'sidechain-device', type: 'sidechain-compressor-proxy' }];
        mockStoreValue.value = { routes: [route] };

        const result = removeSidechainRouteSnapshot(route);

        expect(result.status).toBe('written');
        expect(mocks.storeSet).toHaveBeenCalledWith({ routes: [] });
    });

    it('reconciles an ambiguous removal by rewiring a route still present in durable truth', async () => {
        mockStoreValue.value = { routes: [route] };
        const result = removeSidechainRouteSnapshot(route);
        mockStoreValue.value = { routes: [route] };

        await result.afterAmbiguousCommit?.();
        await result.afterAmbiguousCommit?.();

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('source', 'sidechain-device');
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('source', 'target', 'sidechain-device');
        expect(mocks.wireSidechainRoute).toHaveBeenCalledTimes(1);
    });
});
