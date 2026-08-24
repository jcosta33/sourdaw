import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { createTrack } from '../../../models/Track';
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

const addedDelayDevice = {
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
        const action = createReorderAction();
        const batchContext = createBatchContext(action);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });
        const expectedBeforeTrack = {
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

        expect(handleReorderDevices.describe(action).inverseAction?.payload.expectedBefore).toEqual(
            postReorderTopology
        );
        expect(handleReorderDevices.validate?.(action, batchContext)).toBe(true);

        mocks.getTrackStoreState.mockReturnValue({ tracks: [expectedBeforeTrack] });

        const result = handleReorderDevices.execute(action, batchContext);
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
        const action = createReorderAction();
        const batchContext = createBatchContext(action);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [currentTrack] });

        action.payload.expectedBefore = currentTopology;
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
            ...preReorderTopology,
            devices: [...preReorderTopology.devices, preReorderTopology.devices[0]!],
        };

        expect(handleReorderDevices.validate?.(action, batchContext)).toBe(false);
        expect(handleReorderDevices.execute(action, batchContext)).toEqual({ status: 'conflict' });
        expect(mocks.reorderDevicesInProject).not.toHaveBeenCalled();
    });
});
