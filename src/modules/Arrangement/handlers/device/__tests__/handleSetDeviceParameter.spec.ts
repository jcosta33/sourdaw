import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleSetDeviceParameter } from '../handleSetDeviceParameter';

const mocks = vi.hoisted(() => ({
    captureAutomationRecordingRollback: vi.fn<() => () => void>(),
    setDeviceParameter: vi.fn(),
    updateDeviceParam: vi.fn(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: {
                id: string;
                name?: string;
                frozen?: boolean;
                devices: {
                    id: string;
                    name?: string;
                    type?: string;
                    parameterValues: Record<string, number>;
                }[];
            }[];
        } | null
    >(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    captureAutomationRecordingRollback: mocks.captureAutomationRecordingRollback,
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
        mocks.captureAutomationRecordingRollback.mockReturnValue(vi.fn());
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

    it('describes the exact committed compressor parameter outcome', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-bass-di',
                    name: 'Bass DI',
                    devices: [
                        {
                            id: 'device-bass-di-compressor',
                            name: 'Compressor',
                            type: 'builtin-compressor',
                            parameterValues: { 'comp-threshold': -24 },
                        },
                    ],
                },
            ],
        });

        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'device-bass-di-compressor',
                paramId: 'comp-threshold',
                value: -18,
            },
        });

        expect(desc.label).toBe(
            'Set "Bass DI" (track-bass-di) device "Compressor" (device-bass-di-compressor, builtin-compressor) parameter "Threshold" (comp-threshold) from -24 dB to -18 dB'
        );
    });

    it('describes an inverse restoring the previous parameter value', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'compressor', parameterValues: { gain: 0.8 } }] }],
        });

        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'd1',
                paramId: 'gain',
                value: 0.8,
                expectedTrackId: 't1',
                expectedDeviceType: 'compressor',
                expectedDeviceIds: ['d1'],
                expectedValue: 0.5,
                expectedValuePresent: true,
            },
        });
    });

    it.each([
        ['track owner', { expectedTrackId: 'other-track' }],
        ['device type', { expectedDeviceType: 'eq' }],
        ['device chain', { expectedDeviceIds: ['other-device'] }],
        ['current value', { expectedValue: 0.7 }],
    ] as const)('rejects a stale app-owned %s guard before mutation', (_label, staleGuard) => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'compressor', parameterValues: { gain: 0.8 } }] }],
        });
        const action: Extract<AppAction, { type: 'setDeviceParameter' }> = {
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'd1',
                paramId: 'gain',
                value: 0.5,
                expectedTrackId: 't1',
                expectedDeviceType: 'compressor',
                expectedDeviceIds: ['d1'],
                expectedValue: 0.8,
                ...staleGuard,
            },
        };

        expect(handleSetDeviceParameter.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.setDeviceParameter).not.toHaveBeenCalled();
    });

    it('rejects a stale app-owned frozen eligibility guard before mutation', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    frozen: true,
                    devices: [{ id: 'd1', type: 'compressor', parameterValues: { gain: 0.8 } }],
                },
            ],
        });

        const result = handleSetDeviceParameter.execute({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'd1',
                paramId: 'gain',
                value: 0.5,
                expectedTrackId: 't1',
                expectedDeviceType: 'compressor',
                expectedDeviceIds: ['d1'],
                expectedValue: 0.8,
                expectedTrackFrozen: false,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setDeviceParameter).not.toHaveBeenCalled();
    });

    it('describes presence-aware undo and redo when a declared parameter is absent', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    frozen: false,
                    devices: [{ id: 'd1', type: 'grand-boule', parameterValues: {} }],
                },
            ],
        });

        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'lidPosition', value: 0.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'd1',
                paramId: 'lidPosition',
                value: 1,
                deleteParameter: true,
                expectedDeviceIds: ['d1'],
                expectedDeviceType: 'grand-boule',
                expectedTrackFrozen: false,
                expectedTrackId: 't1',
                expectedValue: 0.5,
                expectedValuePresent: true,
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'd1',
                paramId: 'lidPosition',
                value: 0.5,
                expectedDeviceIds: ['d1'],
                expectedDeviceType: 'grand-boule',
                expectedTrackFrozen: false,
                expectedTrackId: 't1',
                expectedValue: undefined,
                expectedValuePresent: false,
            },
        });
    });

    it('preserves an explicit expected value as a present-value redo guard before a batch-created device exists', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'd1',
                paramId: 'filter-cutoff',
                value: 250,
                expectedTrackId: 't1',
                expectedDeviceType: 'builtin-filter',
                expectedDeviceIds: ['d1'],
                expectedValue: 1_000,
                expectedTrackFrozen: false,
            },
        });

        expect(desc.redoAction).toEqual({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'd1',
                paramId: 'filter-cutoff',
                value: 250,
                expectedDeviceIds: ['d1'],
                expectedDeviceType: 'builtin-filter',
                expectedTrackFrozen: false,
                expectedTrackId: 't1',
                expectedValue: 1_000,
                expectedValuePresent: true,
            },
        });
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

    it('restores runtime and automation-recording state through the abort owner', async () => {
        const rollbackAutomationRecording = vi.fn();
        mocks.captureAutomationRecordingRollback.mockReturnValue(rollbackAutomationRecording);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'compressor', parameterValues: { gain: 0.8 } }] }],
        });
        const action: Extract<AppAction, { type: 'setDeviceParameter' }> = {
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        };

        await handleSetDeviceParameter.prepareAbort?.(action)();

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.8);
        expect(rollbackAutomationRecording).toHaveBeenCalledOnce();
        expect(handleSetDeviceParameter.requiresAbortCompensation).toBe(false);
    });

    it('still restores automation-recording state when runtime rollback fails', () => {
        const rollbackAutomationRecording = vi.fn();
        mocks.captureAutomationRecordingRollback.mockReturnValue(rollbackAutomationRecording);
        mocks.updateDeviceParam.mockImplementation(() => {
            throw new Error('runtime unavailable');
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'compressor', parameterValues: { gain: 0.8 } }] }],
        });
        const action: Extract<AppAction, { type: 'setDeviceParameter' }> = {
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        };

        const rollback = handleSetDeviceParameter.prepareAbort?.(action);

        expect(rollback).toBeTypeOf('function');
        expect(() => rollback?.()).toThrow('manual repair is required: runtime unavailable');
        expect(rollbackAutomationRecording).toHaveBeenCalledOnce();
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
