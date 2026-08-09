import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetDeviceParameter } from '../handleSetDeviceParameter';

const mocks = vi.hoisted(() => ({
    setDeviceParameter: vi.fn(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: { id: string; devices: { id: string; parameterValues: Record<string, number> }[] }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/device/setDeviceParameter/setDeviceParameter', () => ({
    setDeviceParameter: mocks.setDeviceParameter,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetDeviceParameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('delegates the authoritative mutation once and reports a write', () => {
        mocks.setDeviceParameter.mockReturnValue(true);

        const result = handleSetDeviceParameter.execute({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(mocks.setDeviceParameter).toHaveBeenCalledWith('d1', 'gain', 0.5);
        expect(mocks.setDeviceParameter).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when the authoritative use case rejects the owner', () => {
        mocks.setDeviceParameter.mockReturnValue(false);

        const result = handleSetDeviceParameter.execute({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description reflecting the parameter', () => {
        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });
        expect(desc.label).toBe('Set gain');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the previous parameter value', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', parameterValues: { gain: 0.8 } }] }],
        });

        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.8 },
        });
    });

    it('describes a null inverse when the parameter has no stored value to restore', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', parameterValues: {} }] }],
        });

        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('detects an unchanged parameter value as a semantic no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', parameterValues: { gain: 0.5 } }] }],
        });

        const isNoop = handleSetDeviceParameter.isNoop?.({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(isNoop).toBe(true);
    });

    // `docs/manual/devices/07-gluten.md` prints this flag as a promise to the
    // user — "individual control moves *are* recorded" — and Grinder's page
    // relies on it for the assistant route. The manual carried the opposite
    // claim for a year because whoever routed `setGlutenParamWithAudio` through
    // `executeAppAction` had no way to know a page depended on the outcome.
    // Flipping this to `false` makes both pages wrong.
    it('is undoable', () => {
        expect(handleSetDeviceParameter.undoable).toBe(true);
    });
});
