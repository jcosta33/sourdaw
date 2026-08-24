import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { createTrack } from '../../../models/Track';
import { type Track } from '../../../models/Track';
import { handleReorderDevices } from '../handleReorderDevices';

type AddDeviceAction = Extract<AppAction, { type: 'addDevice' }>;
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

const currentTopology = {
    id: 'audio-1',
    kind: 'audio' as const,
    devices: [
        { id: 'device-1', type: 'builtin-compressor', parameterIds: [] },
        { id: 'device-2', type: 'builtin-eq', parameterIds: ['frequency'] },
    ],
};

const preReorderTopology = {
    id: 'audio-1',
    kind: 'audio' as const,
    devices: [
        { id: 'device-1', type: 'builtin-compressor', parameterIds: [] },
        {
            id: 'device-3',
            type: 'builtin-delay',
            parameterIds: ['delay-feedback', 'delay-highcut', 'delay-lowcut', 'delay-mix', 'delay-time'],
        },
        { id: 'device-2', type: 'builtin-eq', parameterIds: ['frequency'] },
    ],
};

const postReorderTopology = {
    id: 'audio-1',
    kind: 'audio' as const,
    devices: [
        {
            id: 'device-3',
            type: 'builtin-delay',
            parameterIds: ['delay-feedback', 'delay-highcut', 'delay-lowcut', 'delay-mix', 'delay-time'],
        },
        { id: 'device-1', type: 'builtin-compressor', parameterIds: [] },
        { id: 'device-2', type: 'builtin-eq', parameterIds: ['frequency'] },
    ],
};

const addedDelayDevice: Track['devices'][number] = {
    id: 'device-3',
    name: 'Delay',
    type: 'builtin-delay',
    bypassed: false,
    parameterValues: {
        'delay-time': 250,
        'delay-feedback': 0.4,
        'delay-lowcut': 80,
        'delay-highcut': 12000,
        'delay-mix': 0.3,
    },
};

function createAddDeviceAction(): AddDeviceAction {
    return {
        type: 'addDevice',
        payload: {
            trackId: 'audio-1',
            deviceType: 'builtin-delay',
            deviceId: 'device-3',
            afterDeviceId: 'device-1',
        },
    };
}

function createBatchContext(
    addDeviceAction: AddDeviceAction,
    reorderAction: ReorderDevicesAction
): HandlerValidationContext {
    return {
        actionIndex: 1,
        actions: [addDeviceAction, reorderAction],
    };
}

function createReorderAction(): ReorderDevicesAction {
    return {
        type: 'reorderDevices',
        payload: {
            trackId: 'audio-1',
            deviceId: 'device-3',
            targetIndex: 0,
            expectedBefore: preReorderTopology,
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
        const addDeviceAction: AddDeviceAction = createAddDeviceAction();
        const reorderAction: ReorderDevicesAction = createReorderAction();
        const batchContext = createBatchContext(addDeviceAction, reorderAction);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });
        const expectedBeforeTrack: Track = {
            ...currentTrack,
            devices: [
                {
                    id: 'device-1',
                    name: 'Compressor',
                    type: 'builtin-compressor',
                    bypassed: false,
                    parameterValues: {},
                },
                addedDelayDevice,
                {
                    id: 'device-2',
                    name: 'EQ',
                    type: 'builtin-eq',
                    bypassed: false,
                    parameterValues: { frequency: 1000 },
                },
            ],
        };
        const afterTrack = {
            ...expectedBeforeTrack,
            devices: [addedDelayDevice, expectedBeforeTrack.devices[0]!, expectedBeforeTrack.devices[2]!],
        };

        const inverseAction = handleReorderDevices.describe(reorderAction).inverseAction;
        if (!inverseAction || inverseAction.type !== 'reorderDevices') {
            throw new Error('Expected reorderDevices to describe an exact reorder inverse');
        }
        expect(inverseAction.payload.expectedBefore).toEqual(postReorderTopology);
        expect(handleReorderDevices.validate?.(reorderAction, batchContext)).toBe(true);

        mocks.getTrackStoreState.mockReturnValue({ tracks: [expectedBeforeTrack] });

        const result = handleReorderDevices.execute(reorderAction, batchContext);
        expect(result).toMatchObject({ status: 'written' });
        if (!result || result instanceof Promise || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a written reorder result');
        }

        expect(mocks.reorderDevicesInProject).toHaveBeenCalledWith('audio-1', afterTrack);

        result.afterCommit();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith({
            before: expectedBeforeTrack,
            after: afterTrack,
            operation: 'reorder-device',
            batchContext,
        });
    });

    it('rejects mismatched planned topology before any project write', () => {
        const currentTrack = createAudioTrack();
        const addDeviceAction: AddDeviceAction = createAddDeviceAction();
        const reorderAction: ReorderDevicesAction = createReorderAction();
        const batchContext = createBatchContext(addDeviceAction, reorderAction);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });

        reorderAction.payload.expectedBefore = currentTopology;
        expect(handleReorderDevices.validate?.(reorderAction, batchContext)).toBe(false);
        expect(handleReorderDevices.execute(reorderAction, batchContext)).toEqual({ status: 'conflict' });
        expect(mocks.reorderDevicesInProject).not.toHaveBeenCalled();
    });

    it('rejects nonunique before-topology proofs before any project write', () => {
        const currentTrack = createAudioTrack();
        const addDeviceAction: AddDeviceAction = createAddDeviceAction();
        const reorderAction: ReorderDevicesAction = createReorderAction();
        const batchContext = createBatchContext(addDeviceAction, reorderAction);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });

        reorderAction.payload.expectedBefore = {
            ...preReorderTopology,
            devices: [...preReorderTopology.devices, preReorderTopology.devices[0]!],
        };

        expect(handleReorderDevices.validate?.(reorderAction, batchContext)).toBe(false);
        expect(handleReorderDevices.execute(reorderAction, batchContext)).toEqual({ status: 'conflict' });
        expect(mocks.reorderDevicesInProject).not.toHaveBeenCalled();
    });
});
