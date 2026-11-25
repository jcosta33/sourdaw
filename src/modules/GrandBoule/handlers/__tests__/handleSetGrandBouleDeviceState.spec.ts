import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GrandBouleAppAction } from '../../events/grandBouleAppActions';
import { createDefaultGrandBoulePersistedState, toGrandBouleDeviceState } from '../../models/GrandBouleDeviceState';
import { handleSetGrandBouleDeviceState } from '../handleSetGrandBouleDeviceState';

const mocks = vi.hoisted(() => ({
    applyDevicePatchState: vi.fn(),
    captureDevicePatchCommitValidation: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
    reconcile: vi.fn(),
    trackStore: { value: { tracks: [] as unknown[] } },
    isCurrent: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    applyDevicePatchState: mocks.applyDevicePatchState,
    captureDevicePatchCommitValidation: mocks.captureDevicePatchCommitValidation,
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));
vi.mock('#/modules/Project/stores', () => ({
    projectTransitionEpoch: { captureEditAuthority: () => ({ isCurrent: mocks.isCurrent }) },
}));
vi.mock('../../useCases/reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

const DEVICE_ID = 'grand-1';
const TRACK_ID = 'piano';
const neutral = toGrandBouleDeviceState(createDefaultGrandBoulePersistedState());
const voiced = { ...neutral, data: { ...neutral.data, temperament: 2, morphPosition: 0.75, enabled: true } };
const action: GrandBouleAppAction = {
    type: 'setGrandBouleDeviceState',
    payload: { trackId: TRACK_ID, deviceId: DEVICE_ID, before: null, after: voiced },
};
const proof = {
    captureWrittenState: vi.fn(),
    validation: { release: vi.fn() },
};

function setProjection(chunk?: typeof neutral, frozen = false): void {
    const device = { id: DEVICE_ID, type: 'grand-boule' };
    mocks.trackStore.value.tracks = [
        { id: TRACK_ID, frozen, devices: [chunk === undefined ? device : { ...device, deviceState: chunk }] },
    ];
}

describe('handleSetGrandBouleDeviceState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyDevicePatchState.mockReturnValue(true);
        mocks.captureDevicePatchCommitValidation.mockReturnValue({ start: () => proof });
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'eligible', trackId: TRACK_ID });
        mocks.isCurrent.mockReturnValue(true);
        proof.captureWrittenState.mockReturnValue(true);
        setProjection();
    });

    it('writes the exact chunk footprint and reconciles the addressed device after commit', async () => {
        handleSetGrandBouleDeviceState.describe(action);
        const result = await handleSetGrandBouleDeviceState.execute(action);

        expect(mocks.captureDevicePatchCommitValidation).toHaveBeenCalledWith({
            deviceId: DEVICE_ID,
            trackId: TRACK_ID,
            parameterIds: [],
            requireCurrentProjection: true,
        });
        expect(mocks.applyDevicePatchState).toHaveBeenCalledWith({
            deviceId: DEVICE_ID,
            expected: { deviceState: null, parameterValues: {} },
            next: { deviceState: voiced, parameterValues: {} },
        });
        expect(result?.status).toBe('written');
        expect(mocks.reconcile).not.toHaveBeenCalled();
        await result?.afterCommit?.();
        expect(mocks.reconcile).toHaveBeenCalledWith(DEVICE_ID);
    });

    it('refuses a changed raw source after admission even when the decoded voicing is still neutral', async () => {
        handleSetGrandBouleDeviceState.describe(action);
        setProjection(neutral);

        await expect(Promise.resolve(handleSetGrandBouleDeviceState.execute(action))).resolves.toEqual({
            status: 'conflict',
        });
        expect(mocks.applyDevicePatchState).not.toHaveBeenCalled();
    });

    it('refuses a frozen owner before mutation', async () => {
        handleSetGrandBouleDeviceState.describe(action);
        setProjection(undefined, true);
        expect(await handleSetGrandBouleDeviceState.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.applyDevicePatchState).not.toHaveBeenCalled();
    });

    it('requires the saved inverse and redo to match the forward owner and exact raw chunks', () => {
        const inverseAction: GrandBouleAppAction = {
            type: action.type,
            payload: { ...action.payload, before: voiced, after: null },
        };
        const entry = { action, inverseAction, redoAction: action };
        expect(handleSetGrandBouleDeviceState.describe(action).inverseAction).toEqual(inverseAction);
        expect(handleSetGrandBouleDeviceState.validateSessionEntry?.(entry)).toBe(true);
        expect(
            handleSetGrandBouleDeviceState.validateSessionEntry?.({
                ...entry,
                inverseAction: { ...inverseAction, payload: { ...inverseAction.payload, after: neutral } },
            })
        ).toBe(false);
        expect(
            handleSetGrandBouleDeviceState.validateSessionEntry?.({
                ...entry,
                redoAction: { ...action, payload: { ...action.payload, trackId: 'other-piano' } },
            })
        ).toBe(false);
    });
});
