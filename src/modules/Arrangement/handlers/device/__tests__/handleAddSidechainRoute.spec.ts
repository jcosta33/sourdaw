import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleAddSidechainRoute } from '../handleAddSidechainRoute';

const mocks = vi.hoisted(() => ({
    addSidechainRouteSnapshot: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    addSidechainRouteSnapshot: mocks.addSidechainRouteSnapshot,
    getSidechainTargetCapability: (deviceType: string) =>
        deviceType === 'builtin-sidechain-compressor' ? { targetParameterId: 'threshold' } : null,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

const supportedDevice = {
    id: 'sidechain-device',
    type: 'builtin-sidechain-compressor',
};

describe('handleAddSidechainRoute', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'target', devices: [supportedDevice], clips: [] }],
        });
    });

    it('mints one stable route identity and captures the complete inverse snapshot', () => {
        const action: Extract<AppAction, { type: 'addSidechainRoute' }> = {
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        };

        const firstDescription = handleAddSidechainRoute.describe(action);
        const secondDescription = handleAddSidechainRoute.describe(action);

        expect(action.payload.routeId?.startsWith('sidechain-')).toBe(true);
        expect(action.payload).toEqual({
            sourceTrackId: 'source',
            targetTrackId: 'target',
            routeId: action.payload.routeId,
            targetDeviceId: 'sidechain-device',
            targetParameterId: 'threshold',
            gain: 1,
        });
        expect(secondDescription.inverseAction).toEqual(firstDescription.inverseAction);
        expect(firstDescription.inverseAction).toEqual({
            type: 'removeSidechainRoute',
            payload: action.payload,
        });
    });

    it('preserves the canonical absent-target no-op while materializing command arguments', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'target', devices: [], clips: [] }],
        });
        const action: Extract<AppAction, { type: 'addSidechainRoute' }> = {
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target', routeId: 'route-1' },
        };

        expect(() => handleAddSidechainRoute.materializeCommandArguments?.(action)).not.toThrow();
        expect(handleAddSidechainRoute.isNoop?.(action)).toBe(true);
        expect(action.payload).toEqual({
            sourceTrackId: 'source',
            targetTrackId: 'target',
            routeId: 'route-1',
        });
    });

    it('accepts only the exact supported device type', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'target', devices: [{ id: 'lookalike', type: 'my-sidechain-helper' }], clips: [] }],
        });

        const result = handleAddSidechainRoute.execute({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.addSidechainRouteSnapshot).not.toHaveBeenCalled();
    });

    it('reports ambiguous supported-device ownership as a conflict', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'target',
                    devices: [supportedDevice, { id: 'second-sidechain-device', type: 'builtin-sidechain-compressor' }],
                    clips: [],
                },
            ],
        });

        const result = handleAddSidechainRoute.execute({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.addSidechainRouteSnapshot).not.toHaveBeenCalled();
    });

    it('forwards explicit status and deferred runtime effects from Routing', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.addSidechainRouteSnapshot.mockReturnValue({
            status: 'written',
            afterCommit,
            afterAmbiguousCommit,
        });
        const action: Extract<AppAction, { type: 'addSidechainRoute' }> = {
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        };

        const result = handleAddSidechainRoute.execute(action);

        expect(mocks.addSidechainRouteSnapshot).toHaveBeenCalledWith({
            id: action.payload.routeId,
            sourceTrackId: 'source',
            targetTrackId: 'target',
            targetDeviceId: 'sidechain-device',
            targetParameterId: 'threshold',
            gain: 1,
        });
        expect(result).toEqual({ status: 'written', afterCommit, afterAmbiguousCommit });
    });
});
