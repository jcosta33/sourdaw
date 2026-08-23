import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { createTrack } from '../../../models/Track';
import { runtimeGraphTopology } from '../../../useCases/runtimeGraphTopology';
import { getPlannedTrackState } from '../../getPlannedTrackState';
import { handleReorderDevices } from '../handleReorderDevices';

type ReorderDevicesAction = Extract<AppAction, { type: 'reorderDevices' }>;

const mocks = vi.hoisted(() => ({
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    getTrackStoreState: vi.fn(),
    reorderDevicesInProject: vi.fn(),
}));

vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('../../../useCases/device/reorderDevices', () => ({
    reorderDevicesInProject: mocks.reorderDevicesInProject,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

function createAudioTrack() {
    const track = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
    track.devices = [
        { id: 'device-1', name: 'Compressor', type: 'builtin-compressor', bypassed: false, parameterValues: {} },
        { id: 'device-2', name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: { frequency: 1000 } },
    ];
    return track;
}

function createBatchContext(action: ReorderDevicesAction): HandlerValidationContext {
    return {
        actionIndex: 1,
        actions: [
            {
                type: 'addDevice',
                payload: {
                    trackId: 'audio-1',
                    deviceType: 'builtin-delay',
                    deviceId: 'device-3',
                    afterDeviceId: 'device-1',
                },
            },
            action,
        ],
    };
}

function createReorderAction(): ReorderDevicesAction {
    return {
        type: 'reorderDevices',
        payload: {
            trackId: 'audio-1',
            deviceId: 'device-3',
            targetIndex: 0,
            expectedBefore: { id: 'audio-1', kind: 'audio', devices: [] },
        },
    };
}

describe('handleReorderDevices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
    });

    it('validates and executes against planned same-batch topology after an earlier same-track add', () => {
        const currentTrack = createAudioTrack();
        const action = createReorderAction();
        const batchContext = createBatchContext(action);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });
        const plannedTrack = getPlannedTrackState(batchContext, 'audio-1');
        if (!plannedTrack) {
            throw new Error('Expected a projected track for the reorder batch');
        }
        const afterTrack = {
            ...plannedTrack,
            devices: [plannedTrack.devices[1]!, plannedTrack.devices[0]!, plannedTrack.devices[2]!],
        };
        action.payload.expectedBefore = runtimeGraphTopology.createNode(plannedTrack);

        expect(handleReorderDevices.validate?.(action, batchContext)).toBe(true);

        const result = handleReorderDevices.execute(action, batchContext);
        if (!result || result instanceof Promise || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a written reorder result');
        }

        expect(mocks.reorderDevicesInProject).toHaveBeenCalledWith('audio-1', afterTrack);

        result.afterCommit();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith({
            before: plannedTrack,
            after: afterTrack,
            operation: 'reorder-device',
            batchContext,
        });
    });

    it('rejects mismatched planned topology before any project write', () => {
        const currentTrack = createAudioTrack();
        const action = createReorderAction();
        const batchContext = createBatchContext(action);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });

        action.payload.expectedBefore = runtimeGraphTopology.createNode(currentTrack);
        expect(handleReorderDevices.validate?.(action, batchContext)).toBe(false);
        expect(handleReorderDevices.execute(action, batchContext)).toEqual({ status: 'conflict' });
        expect(mocks.reorderDevicesInProject).not.toHaveBeenCalled();
    });

    it('rejects nonunique before-topology proofs before any project write', () => {
        const currentTrack = createAudioTrack();
        const action = createReorderAction();
        const batchContext = createBatchContext(action);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });

        action.payload.expectedBefore = {
            ...runtimeGraphTopology.createNode(getPlannedTrackState(batchContext, 'audio-1') ?? currentTrack),
            devices: [
                ...runtimeGraphTopology.createNode(getPlannedTrackState(batchContext, 'audio-1') ?? currentTrack)
                    .devices,
                runtimeGraphTopology.createNode(getPlannedTrackState(batchContext, 'audio-1') ?? currentTrack)
                    .devices[0]!,
            ],
        };

        expect(handleReorderDevices.validate?.(action, batchContext)).toBe(false);
        expect(handleReorderDevices.execute(action, batchContext)).toEqual({ status: 'conflict' });
        expect(mocks.reorderDevicesInProject).not.toHaveBeenCalled();
    });
});
