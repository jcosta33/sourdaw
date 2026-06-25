import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../setSidechainRoutes';
import { setSidechainRoutes } from '../setSidechainRoutes';

import type { SidechainRoute } from '../../../models/SidechainRoute';

const mocks = vi.hoisted(() => ({
    wireSidechainRoute: vi.fn<(...args: unknown[]) => unknown>(),
    unwireSidechainRoute: vi.fn<(...args: unknown[]) => unknown>(),
    getEngineState: vi.fn<() => { isReady: boolean }>(),
    storeSet: vi.fn((next: unknown) => {
        mockStoreValue.value = next;
    }),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    wireSidechainRoute: mocks.wireSidechainRoute,
    unwireSidechainRoute: mocks.unwireSidechainRoute,
    getEngineState: mocks.getEngineState,
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

function route(partial: Partial<SidechainRoute>): SidechainRoute {
    return {
        id: 'r1',
        sourceTrackId: 'src',
        targetTrackId: 'dst',
        targetDeviceId: 'dev1',
        targetParameterId: 'threshold',
        ...partial,
    } as SidechainRoute;
}

describe('setSidechainRoutes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStoreValue.value = { routes: [] };
        mocks.getEngineState.mockReturnValue({ isReady: true });
    });

    it('should export setSidechainRoutes', () => {
        expect(subject.setSidechainRoutes).toBeDefined();
        const time = typeof subject.setSidechainRoutes;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    // Regression for the fallback-mode divergence: setSidechainRoutes used to
    // return void and rely on the engine's wire/unwire, which silently no-op'd in
    // fallback mode — leaving the store updated but the live graph un-wired with
    // no recovery. The use case must (a) still issue the wiring (so the engine
    // can queue it for replay) and (b) surface that it was not applied live.
    describe('fallback-mode visibility and recovery', () => {
        it('issues wiring for every route even when the engine is not ready', () => {
            mocks.getEngineState.mockReturnValue({ isReady: false });

            const routes = [
                route({ id: 'r1', sourceTrackId: 'a', targetTrackId: 'b', targetDeviceId: 'devA' }),
                route({ id: 'r2', sourceTrackId: 'c', targetTrackId: 'd', targetDeviceId: 'devB' }),
            ];

            setSidechainRoutes(routes);

            // Routes persisted to project truth.
            expect(mocks.storeSet).toHaveBeenCalledWith({ routes });
            // Wiring still requested (the engine queues these in fallback mode),
            // not skipped — so the intent is preserved for replay on recovery.
            expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('a', 'b', 'devA');
            expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('c', 'd', 'devB');
        });

        it('reports wiredLive=false when the engine is not ready (recoverable state surfaced)', () => {
            mocks.getEngineState.mockReturnValue({ isReady: false });

            const result = setSidechainRoutes([
                route({ sourceTrackId: 'a', targetTrackId: 'b', targetDeviceId: 'devA' }),
            ]);

            expect(result.wiredLive).toBe(false);
        });

        it('reports wiredLive=true when the engine is ready', () => {
            mocks.getEngineState.mockReturnValue({ isReady: true });

            const result = setSidechainRoutes([
                route({ sourceTrackId: 'a', targetTrackId: 'b', targetDeviceId: 'devA' }),
            ]);

            expect(result.wiredLive).toBe(true);
            expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('a', 'b', 'devA');
        });
    });

    it('unwires the previous routes before wiring the new set', () => {
        mockStoreValue.value = {
            routes: [route({ id: 'old', sourceTrackId: 'x', targetDeviceId: 'devX' })],
        };

        setSidechainRoutes([route({ id: 'new', sourceTrackId: 'y', targetTrackId: 'z', targetDeviceId: 'devY' })]);

        expect(mocks.unwireSidechainRoute).toHaveBeenCalledWith('x', 'devX');
        expect(mocks.wireSidechainRoute).toHaveBeenCalledWith('y', 'z', 'devY');
    });
});
