import { beforeEach, describe, expect, it, vi } from 'vitest';

type SidechainState = {
    routes: Array<{
        id: string;
        sourceTrackId: string;
        targetTrackId: string;
        targetDeviceId: string;
        targetParameterId: string;
        gain: number;
    }>;
};

type HydrationMocks = {
    currentState: SidechainState;
    hydratedState: SidechainState;
    hydrate: ReturnType<typeof vi.fn<() => void>>;
    logError: ReturnType<typeof vi.fn<(error: Error) => void>>;
    reconcileSidechainRouteRuntime: ReturnType<
        typeof vi.fn<(input: { sourceTrackId: string; targetDeviceId: string }) => void>
    >;
};

const mocks = vi.hoisted((): HydrationMocks => ({
    currentState: { routes: [] },
    hydratedState: { routes: [] },
    hydrate: vi.fn(() => {
        mocks.currentState = mocks.hydratedState;
    }),
    logError: vi.fn(),
    reconcileSidechainRouteRuntime: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.logError },
}));

vi.mock('../../stores/sidechainStore', () => ({
    sidechainStore: {
        get value() {
            return mocks.currentState;
        },
        hydrate: mocks.hydrate,
    },
}));

vi.mock('../sidechain/reconcileSidechainRouteRuntime', () => ({
    reconcileSidechainRouteRuntime: mocks.reconcileSidechainRouteRuntime,
}));

import { hydrateSidechainRoutes } from '../hydrateSidechainRoutes';

function createRoute(id: string, sourceTrackId: string, targetDeviceId: string) {
    return {
        id,
        sourceTrackId,
        targetTrackId: `target-${id}`,
        targetDeviceId,
        targetParameterId: 'threshold',
        gain: 1,
    };
}

describe('hydrateSidechainRoutes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentState = { routes: [] };
        mocks.hydratedState = { routes: [] };
    });

    it('reconciles the union of previous and hydrated runtime keys exactly once', () => {
        mocks.currentState = {
            routes: [createRoute('removed', 'source-a', 'device-a'), createRoute('stable', 'source-b', 'device-b')],
        };
        mocks.hydratedState = {
            routes: [createRoute('stable', 'source-b', 'device-b'), createRoute('added', 'source-c', 'device-c')],
        };

        hydrateSidechainRoutes();

        expect(mocks.hydrate).toHaveBeenCalledTimes(1);
        expect(mocks.reconcileSidechainRouteRuntime.mock.calls).toEqual([
            [{ sourceTrackId: 'source-a', targetDeviceId: 'device-a' }],
            [{ sourceTrackId: 'source-b', targetDeviceId: 'device-b' }],
            [{ sourceTrackId: 'source-c', targetDeviceId: 'device-c' }],
        ]);
    });

    it('continues reconciling runtime keys when one audio-engine repair fails', () => {
        const runtimeFailure = new Error('audio engine unavailable');
        mocks.hydratedState = {
            routes: [createRoute('first', 'source-a', 'device-a'), createRoute('second', 'source-b', 'device-b')],
        };
        mocks.reconcileSidechainRouteRuntime.mockImplementationOnce(() => {
            throw runtimeFailure;
        });

        expect(() => hydrateSidechainRoutes()).not.toThrow();

        expect(mocks.reconcileSidechainRouteRuntime.mock.calls).toEqual([
            [{ sourceTrackId: 'source-a', targetDeviceId: 'device-a' }],
            [{ sourceTrackId: 'source-b', targetDeviceId: 'device-b' }],
        ]);
        expect(mocks.logError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Sidechain runtime reconciliation failed during project hydration',
                cause: runtimeFailure,
            })
        );
    });
});
