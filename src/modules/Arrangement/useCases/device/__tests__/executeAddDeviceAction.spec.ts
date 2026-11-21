import { describe, it, expect, vi, beforeEach } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';

import { handleAddDevice } from '../../../handlers/device/handleAddDevice';
import { executeAddDeviceAction } from '../executeAddDeviceAction';

const mocks = vi.hoisted(() => ({
    writeDeviceToProject: vi.fn(),
    applyDeviceChainRuntimeDelta: vi.fn(),
    updateDeviceParam: vi.fn(),
    getTrackStoreState: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('../addDevice', () => ({
    writeDeviceToProject: mocks.writeDeviceToProject,
}));

vi.mock('../applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

/**
 * The runner outcome issue #2980 reported: on a machine whose audio graph
 * cannot realize the new device (no adapters, or the engine strip is not
 * live), the topology delta comes back rejected while the project write has
 * already committed.
 */
const adapterlessRuntimeRejection = {
    acceptance: 'rejected',
    application: 'not-applied',
    reason: 'Live source strip does not match the compiled device-chain delta',
};

const audioTrack = (devices: Array<{ id: string }> = []) => ({
    id: 't1',
    kind: 'audio',
    frozen: false,
    devices: devices.map((device) => ({ ...device, type: 'builtin-eq', parameterValues: {} })),
});

describe('executeAddDeviceAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        registerHandlerMap({ addDevice: handleAddDevice });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [audioTrack()] });
        mocks.writeDeviceToProject.mockReturnValue({ id: 'device-new', type: 'builtin-eq', parameterValues: {} });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
    });

    it('resolves committed-degraded instead of rejecting when the runtime cannot realize the add', async () => {
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(adapterlessRuntimeRejection);

        // The discriminating assertion: a raw `executeAppAction` dispatch
        // rejects here with AppActionCommittedError, which every fire-and-forget
        // caller turned into an unhandled rejection on adapterless CI runners.
        const result = await executeAddDeviceAction('t1', 'builtin-eq');

        expect(result.status).toBe('committed-degraded');
        expect(result.deviceId).toMatch(/^device-/);
        // The commit stood: the project write ran and the action entered history.
        expect(mocks.writeDeviceToProject).toHaveBeenCalledTimes(1);
        expect(undoStore.value?.past).toHaveLength(1);
        // The degraded runtime is observable, not swallowed.
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('requires runtime retry or repair'),
            'error'
        );
    });

    it('resolves applied with the compiled device id when the runtime realizes the add', async () => {
        const result = await executeAddDeviceAction('t1', 'builtin-eq');

        expect(result.status).toBe('applied');
        expect(result.deviceId).toMatch(/^device-/);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('resolves not-applied and notifies when the track cannot accept the add', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const result = await executeAddDeviceAction('missing-track', 'builtin-eq');

        expect(result).toEqual({ status: 'not-applied', deviceId: null });
        expect(mocks.writeDeviceToProject).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('cannot be added'), 'error');
    });

    it('resolves not-applied and notifies when the dispatch conflicts with current project state', async () => {
        // Compile sees an empty chain; by execute time another device landed,
        // so the guarded expectedDeviceIds no longer match and the handler
        // reports a conflict instead of writing.
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [audioTrack()] })
            .mockReturnValue({ tracks: [audioTrack([{ id: 'device-earlier' }])] });

        const result = await executeAddDeviceAction('t1', 'builtin-eq');

        expect(result).toEqual({ status: 'not-applied', deviceId: null });
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('could not be added'), 'error');
    });
});
