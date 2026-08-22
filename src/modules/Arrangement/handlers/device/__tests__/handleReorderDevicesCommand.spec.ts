import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError, redo, undo } from '#/modules/Command/useCases';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { type DeviceChainRuntimeDeltaSuperseded } from '../../../useCases/device/applyDeviceChainRuntimeDelta';
import { compileReorderDevicesAction } from '../../../useCases/device/compileReorderDevicesAction';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const mocks = vi.hoisted(() => ({
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
}));

vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

/**
 * What the delta reports once its host track left project truth mid-commit.
 * Typed against the production variant so a fixture cannot describe an outcome
 * the union does not carry.
 */
const supersededReorderDelta: DeviceChainRuntimeDeltaSuperseded = {
    acceptance: 'superseded',
    application: 'not-applied',
    reason: 'Track audio-1 left project truth before its reorder-device delta was submitted',
};

function seedAudioTrack(): void {
    const track = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
    track.devices = [
        { id: 'device-1', name: 'Compressor', type: 'builtin-compressor', bypassed: false, parameterValues: {} },
        { id: 'device-2', name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: { frequency: 1000 } },
        { id: 'device-3', name: 'Limiter', type: 'builtin-limiter', bypassed: false, parameterValues: {} },
    ];
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    flushAutomergeStorageWrites();
}

function configureStoragePort(onMutate: () => void): void {
    const document: Record<string, unknown> = {};
    configureAutomergeStoragePort({
        getDoc: () => document,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            onMutate();
            changeFn(document);
        },
    });
}

function compileRackDrop() {
    const action = compileReorderDevicesAction('audio-1', 'device-1', 'device-3');
    if (!action) {
        throw new Error('expected a compiled reorder action');
    }
    return action;
}

function deviceIds(): string[] {
    return trackStore.value?.tracks[0]?.devices.map((device) => device.id) ?? [];
}

describe('handleReorderDevices Command path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        configureAutomergeStoragePort(null);
        seedAudioTrack();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
    });

    it('commits the application-owned rack order once, then supports undo and redo', async () => {
        const effects: string[] = [];
        configureStoragePort(() => {
            effects.push('project-commit');
        });
        mocks.applyDeviceChainRuntimeDelta.mockImplementation(() => {
            effects.push('runtime-delta');
            return { acceptance: 'accepted', application: 'applied' };
        });
        const action = compileRackDrop();

        expect(action.payload).toMatchObject({
            trackId: 'audio-1',
            deviceId: 'device-1',
            targetIndex: 2,
            expectedBefore: {
                id: 'audio-1',
                kind: 'audio',
                devices: [
                    { id: 'device-1', type: 'builtin-compressor', parameterIds: [] },
                    { id: 'device-2', type: 'builtin-eq', parameterIds: ['frequency'] },
                    { id: 'device-3', type: 'builtin-limiter', parameterIds: [] },
                ],
            },
            expectedProjectRevision: expect.any(String),
        });

        await expect(executeAppAction(action)).resolves.toBeUndefined();

        expect(deviceIds()).toEqual(['device-2', 'device-3', 'device-1']);
        expect(effects).toEqual(['project-commit', 'runtime-delta']);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Reorder devices');

        await undo();
        expect(deviceIds()).toEqual(['device-1', 'device-2', 'device-3']);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expect(deviceIds()).toEqual(['device-2', 'device-3', 'device-1']);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledTimes(3);
    });

    it('rejects a stale collaborator reorder before a new project write or runtime effect', async () => {
        const action = compileRackDrop();
        const state = trackStore.value;
        if (!state) {
            throw new Error('expected project state');
        }
        const track = state.tracks[0];
        if (!track) {
            throw new Error('expected audio track');
        }
        trackStore.set({
            ...state,
            tracks: [{ ...track, devices: [track.devices[1]!, track.devices[0]!, track.devices[2]!] }],
        });
        flushAutomergeStorageWrites();
        const writes: string[] = [];
        configureStoragePort(() => {
            writes.push('project-commit');
        });

        await expect(executeAppAction(action)).rejects.toMatchObject({ name: 'AppActionConflictError' });

        expect(deviceIds()).toEqual(['device-2', 'device-1', 'device-3']);
        expect(writes).toEqual([]);
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('rejects duplicate device identities in a forged before-topology proposal before any effect', async () => {
        const action = compileRackDrop();
        action.payload.expectedBefore = {
            ...action.payload.expectedBefore,
            devices: [...action.payload.expectedBefore.devices, action.payload.expectedBefore.devices[0]!],
        };
        const writes: string[] = [];
        configureStoragePort(() => {
            writes.push('project-commit');
        });

        await expect(executeAppAction(action)).rejects.toMatchObject({ name: 'AppActionConflictError' });

        expect(deviceIds()).toEqual(['device-1', 'device-2', 'device-3']);
        expect(writes).toEqual([]);
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it.each([
        [
            'runtime rejection before any live effect',
            { acceptance: 'rejected', application: 'not-applied', reason: 'runtime revision is stale' },
            'retry',
        ],
        [
            'runtime reconciliation requirement after a partial live effect',
            {
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'failed',
                correlation: { appRevision: 3, projectRevision: 'project-3' },
                reason: 'device rebuild left live graph unhealthy',
                runtimeRevision: 4,
            },
            'repair',
        ],
    ])('returns committed %s truth instead of clean success', async (_label, runtimeResult, remediation) => {
        configureStoragePort(() => undefined);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(runtimeResult);

        const committedError = await executeAppAction(compileRackDrop()).then(
            () => {
                throw new Error('Expected committed runtime failure');
            },
            (error: unknown) => error
        );

        expect(isAppActionCommittedError(committedError)).toBe(true);
        if (
            !(committedError instanceof Error) ||
            !isAppActionCommittedError(committedError) ||
            !(committedError.cause instanceof AggregateError)
        ) {
            throw new Error('Expected the Command post-commit receipt to retain the runtime failure');
        }
        expect(committedError.cause.errors).toHaveLength(2);
        for (const runtimeFailure of committedError.cause.errors) {
            expect(runtimeFailure).toMatchObject({
                name: 'RuntimeDeviceDeltaPostCommitError',
                outcome: runtimeResult,
                remediation,
            });
        }

        expect(deviceIds()).toEqual(['device-2', 'device-3', 'device-1']);
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('returns clean success when the same commit superseded the reorder delta', async () => {
        // The host track left project truth later in this commit, so the chain
        // this reorder describes is gone and the strip it would reorder is
        // being torn down by whatever removed the track.
        configureStoragePort(() => undefined);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(supersededReorderDelta);

        await expect(executeAppAction(compileRackDrop())).resolves.toBeUndefined();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(undoStore.value?.past).toHaveLength(1);
    });
});
