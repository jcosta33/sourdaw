import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    createAppActionCommittedError,
    executeAppAction,
    isAppActionCommittedError,
    resetActionReplayAuthority,
    undo,
} from '#/modules/Command/useCases';
import { createCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { executeRemoveDeviceAction } from '../executeRemoveDeviceAction';

const mocks = vi.hoisted(() => ({
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    projectTrackToLiveStrip: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('../applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('../../projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

const removedDevice = {
    id: 'device-2',
    name: 'EQ',
    type: 'builtin-eq',
    bypassed: true,
    parameterValues: { frequency: 2400, gain: -3 },
    deviceState: { mode: 'surgical' },
};

const acceptedRuntimeDelta = { acceptance: 'accepted' as const, application: 'applied' as const };
const rejectedRuntimeDelta = {
    acceptance: 'rejected' as const,
    application: 'not-applied' as const,
    reason: 'Live source strip does not match the compiled device-chain delta',
};

function seedAudioTrack(): void {
    const track = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
    track.devices = [
        { id: 'device-1', name: 'Compressor', type: 'builtin-compressor', bypassed: false, parameterValues: {} },
        structuredClone(removedDevice),
        { id: 'device-3', name: 'Limiter', type: 'builtin-limiter', bypassed: false, parameterValues: {} },
    ];
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
}

function deviceIds(trackId = 'audio-1'): string[] {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.devices.map((device) => device.id) ?? [];
}

describe('executeRemoveDeviceAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(acceptedRuntimeDelta);
        seedAudioTrack();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('removes the concrete device and one undo restores its snapshot at the original index', async () => {
        await expect(executeRemoveDeviceAction(removedDevice.id)).resolves.toEqual({ status: 'applied' });

        expect(deviceIds()).toEqual(['device-1', 'device-3']);
        expect(undoStore.value?.past).toHaveLength(1);

        await expect(undo()).resolves.toEqual({ headConsumed: true });

        expect(deviceIds()).toEqual(['device-1', 'device-2', 'device-3']);
        expect(trackStore.value?.tracks[0]?.devices[1]).toEqual(removedDevice);
    });

    it('resolves committed-degraded truthfully and retains actual undo after runtime reconciliation rejects', async () => {
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(rejectedRuntimeDelta);

        await expect(executeRemoveDeviceAction(removedDevice.id)).resolves.toEqual({
            status: 'committed-degraded',
        });

        expect(deviceIds()).toEqual(['device-1', 'device-3']);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'The device was removed from the project, but completion needs attention.',
            'warning'
        );

        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(acceptedRuntimeDelta);
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks[0]?.devices[1]).toEqual(removedDevice);
    });

    it('keeps raw programmatic dispatch rejection semantics for a committed runtime failure', async () => {
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(rejectedRuntimeDelta);

        const rejection = await executeAppAction({
            type: 'removeDevice',
            payload: { deviceId: removedDevice.id },
        }).then(
            () => null,
            (error: unknown) => error
        );

        expect(isAppActionCommittedError(rejection)).toBe(true);
        expect(deviceIds()).toEqual(['device-1', 'device-3']);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('reports a pre-commit dispatch failure without changing project truth or history', async () => {
        clearHandlerRegistry();

        await expect(executeRemoveDeviceAction(removedDevice.id)).resolves.toEqual({ status: 'not-applied' });

        expect(deviceIds()).toEqual(['device-1', 'device-2', 'device-3']);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith('The device could not be removed from the project.', 'error');
    });

    it('returns not-applied silently when the device is already absent', async () => {
        await expect(executeRemoveDeviceAction('missing-device')).resolves.toEqual({ status: 'not-applied' });

        expect(deviceIds()).toEqual(['device-1', 'device-2', 'device-3']);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('does not duplicate the admission warning when conflicting project truth refuses the removal', async () => {
        const duplicateOwner = createTrack({ id: 'audio-2', kind: 'audio', name: 'Duplicate owner' });
        duplicateOwner.devices = [structuredClone(removedDevice)];
        const state = trackStore.value;
        if (!state) {
            throw new Error('expected track state');
        }
        trackStore.set({ ...state, tracks: [...state.tracks, duplicateOwner] });

        await expect(executeRemoveDeviceAction(removedDevice.id)).resolves.toEqual({ status: 'not-applied' });

        expect(deviceIds()).toEqual(['device-1', 'device-2', 'device-3']);
        expect(deviceIds('audio-2')).toEqual(['device-2']);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('refused'), 'warning');
    });

    it('classifies a committed error even when it arrives before the committed marker', async () => {
        const commandUseCases = await import('#/modules/Command/useCases');
        vi.spyOn(commandUseCases, 'executeUserAppAction').mockRejectedValueOnce(
            createAppActionCommittedError({
                actionType: 'removeDevice',
                cause: new Error('ambiguous storage commit'),
            })
        );

        await expect(executeRemoveDeviceAction(removedDevice.id)).resolves.toEqual({
            status: 'committed-degraded',
        });

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'The device was removed from the project, but completion needs attention.',
            'warning'
        );
    });
});
