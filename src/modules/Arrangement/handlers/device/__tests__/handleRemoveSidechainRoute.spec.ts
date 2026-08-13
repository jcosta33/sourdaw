import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleRemoveSidechainRoute } from '../handleRemoveSidechainRoute';

const mocks = vi.hoisted(() => ({
    getSidechainRoutesForTrack: vi.fn(),
    removeSidechainRouteSnapshot: vi.fn(),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    getSidechainRoutesForTrack: mocks.getSidechainRoutesForTrack,
    removeSidechainRouteSnapshot: mocks.removeSidechainRouteSnapshot,
}));

const route = {
    id: 'route-1',
    sourceTrackId: 'source',
    targetTrackId: 'target',
    targetDeviceId: 'sidechain-device',
    targetParameterId: 'threshold',
    gain: 0.75,
};

describe('handleRemoveSidechainRoute', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSidechainRoutesForTrack.mockReturnValue([route]);
    });

    it('captures the exact removed route for deterministic undo and replay', () => {
        const action: Extract<AppAction, { type: 'removeSidechainRoute' }> = {
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        };

        const description = handleRemoveSidechainRoute.describe(action);

        expect(action.payload).toEqual({
            sourceTrackId: 'source',
            targetTrackId: 'target',
            routeId: 'route-1',
            targetDeviceId: 'sidechain-device',
            targetParameterId: 'threshold',
            gain: 0.75,
        });
        expect(description.inverseAction).toEqual({
            type: 'addSidechainRoute',
            payload: action.payload,
        });
    });

    it('materializes the exact route snapshot before command serialization', () => {
        const action: Extract<AppAction, { type: 'removeSidechainRoute' }> = {
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        };

        expect(() => handleRemoveSidechainRoute.materializeCommandArguments?.(action)).not.toThrow();
        expect(action.payload).toEqual({
            sourceTrackId: 'source',
            targetTrackId: 'target',
            routeId: 'route-1',
            targetDeviceId: 'sidechain-device',
            targetParameterId: 'threshold',
            gain: 0.75,
        });
    });

    it('preserves an absent endpoint as an immutable command no-op', () => {
        mocks.getSidechainRoutesForTrack.mockReturnValue([]);
        const action: Extract<AppAction, { type: 'removeSidechainRoute' }> = {
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        };

        expect(() => handleRemoveSidechainRoute.materializeCommandArguments?.(action)).not.toThrow();
        expect(handleRemoveSidechainRoute.isNoop?.(action)).toBe(true);
        expect(action.payload).toEqual({ sourceTrackId: 'source', targetTrackId: 'target' });
    });

    it('reports ambiguous endpoint matches as a conflict', () => {
        mocks.getSidechainRoutesForTrack.mockReturnValue([
            route,
            { ...route, id: 'route-2', targetDeviceId: 'other-device' },
        ]);

        const result = handleRemoveSidechainRoute.execute({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.removeSidechainRouteSnapshot).not.toHaveBeenCalled();
    });

    it('treats a missing endpoint route as a no-write', () => {
        mocks.getSidechainRoutesForTrack.mockReturnValue([]);

        const result = handleRemoveSidechainRoute.execute({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.removeSidechainRouteSnapshot).not.toHaveBeenCalled();
    });

    it('forwards the exact snapshot and deferred runtime effects from Routing', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.removeSidechainRouteSnapshot.mockReturnValue({
            status: 'written',
            afterCommit,
            afterAmbiguousCommit,
        });

        const result = handleRemoveSidechainRoute.execute({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        });

        expect(mocks.removeSidechainRouteSnapshot).toHaveBeenCalledWith(route);
        expect(result).toEqual({ status: 'written', afterCommit, afterAmbiguousCommit });
    });
});
