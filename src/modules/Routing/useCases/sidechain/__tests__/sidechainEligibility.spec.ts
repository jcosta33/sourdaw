import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addSidechainRoute } from '../addSidechainRoute';
import { removeSidechainRoute } from '../removeSidechainRoute';
import { setSidechainRoutes } from '../setSidechainRoutes';
import { wireSidechainRoutes } from '../wireSidechainRoutes';

type TestRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

const mocks = vi.hoisted(() => ({
    tracks: [] as Array<{ id: string; kind: string }>,
    routes: [] as TestRoute[],
    setRoutes: vi.fn(),
    wireSidechainRoute: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    getEngineState: vi.fn(() => ({ isReady: true })),
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
    getEngineState: mocks.getEngineState,
}));

vi.mock('../../../stores/sidechainStore', () => ({
    sidechainStore: {
        get value() {
            return { routes: mocks.routes };
        },
        set(next: { routes: TestRoute[] }) {
            mocks.routes = next.routes;
            mocks.setRoutes(next);
        },
    },
}));

const ordinaryRoute: TestRoute = {
    id: 'route-audio',
    sourceTrackId: 'audio-1',
    targetTrackId: 'audio-2',
    targetDeviceId: 'device-1',
    targetParameterId: 'threshold',
    gain: 1,
};

const dormantRoute: TestRoute = {
    ...ordinaryRoute,
    id: 'route-vca',
    sourceTrackId: 'vca-1',
};

describe('sidechain eligibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tracks = [
            { id: 'audio-1', kind: 'audio' },
            { id: 'audio-2', kind: 'audio' },
            { id: 'vca-1', kind: 'vca' },
            { id: 'malformed-1', kind: 'malformed' },
        ];
        mocks.routes = [];
    });

    it.each([
        { label: 'dormant source', sourceTrackId: 'vca-1', targetTrackId: 'audio-2' },
        { label: 'dormant destination', sourceTrackId: 'audio-1', targetTrackId: 'vca-1' },
        { label: 'malformed source', sourceTrackId: 'malformed-1', targetTrackId: 'audio-2' },
        { label: 'malformed destination', sourceTrackId: 'audio-1', targetTrackId: 'malformed-1' },
        { label: 'missing source', sourceTrackId: 'missing-source', targetTrackId: 'audio-2' },
        { label: 'missing destination', sourceTrackId: 'audio-1', targetTrackId: 'missing-target' },
    ])('returns no-write for a $label before route, store, or engine work', ({ sourceTrackId, targetTrackId }) => {
        const didWrite = addSidechainRoute(sourceTrackId, targetTrackId, 'device-1');

        expect(mocks.setRoutes).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoute).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('returns written after an ordinary route reaches store and runtime wiring', () => {
        const didWrite = addSidechainRoute('audio-1', 'audio-2', 'device-1');

        expect(mocks.setRoutes).toHaveBeenCalledTimes(1);
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('audio-1', 'audio-2', 'device-1');
        expect(didWrite).toBe(true);
    });

    it('filters dormant VCA endpoints from bulk state and wiring while preserving ordinary routes', () => {
        setSidechainRoutes([dormantRoute, ordinaryRoute]);

        expect(mocks.routes).toEqual([ordinaryRoute]);
        expect(mocks.wireSidechainRoute).toHaveBeenCalledTimes(1);
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('audio-1', 'audio-2', 'device-1');
    });

    it('skips dormant VCA replay but preserves ordinary replay', () => {
        mocks.routes = [dormantRoute, ordinaryRoute];

        wireSidechainRoutes();

        expect(mocks.wireSidechainRoute).toHaveBeenCalledTimes(1);
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('audio-1', 'audio-2', 'device-1');
    });

    it('permits dormant VCA route teardown', () => {
        mocks.routes = [dormantRoute];

        removeSidechainRoute('route-vca');

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('vca-1', 'device-1');
        expect(mocks.routes).toEqual([]);
    });
});
