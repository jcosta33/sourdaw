import { describe, it, expect, vi, beforeEach } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';

import { type DeviceChainRuntimeDeltaSuperseded } from '../../../useCases/device/applyDeviceChainRuntimeDelta';
import { handleAddDevice } from '../handleAddDevice';

const mocks = vi.hoisted(() => ({
    writeDeviceToProject: vi.fn(),
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    updateDeviceParam: vi.fn(),
    getTrackStoreState: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
}));

vi.mock('../../../useCases/device/addDevice', () => ({
    writeDeviceToProject: mocks.writeDeviceToProject,
}));

vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));

/**
 * What the delta reports once its host track left project truth mid-commit.
 * Typed against the production variant so a fixture cannot describe an outcome
 * the union does not carry.
 */
const supersededAddDelta: DeviceChainRuntimeDeltaSuperseded = {
    acceptance: 'superseded',
    application: 'not-applied',
    reason: 'Track t1 left project truth before its add-device delta was submitted',
};

describe('handleAddDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
    });

    it('finalizes the bare chain from the actual post-add chain at execute', () => {
        // The store as it stands after the add — including any chain mutations
        // earlier batch actions made — is what undo's validation compares
        // against, so that is what the inverse must carry.
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'device-existing' }] }],
        });
        const action = { type: 'addDevice', payload: { trackId: 't1', deviceType: 'builtin-eq' } };
        const desc = handleAddDevice.describe(action as never);
        mocks.writeDeviceToProject.mockReturnValue({ id: 'device-new', parameterValues: {} });

        const result = handleAddDevice.execute(action as never);

        expect(result).toMatchObject({ status: 'written' });
        const inverse = desc?.inverseAction;
        if (!inverse || inverse.type !== 'removeDevice') {
            throw new Error('Expected a removeDevice inverse');
        }
        // Finalized from the store chain, not from the describe-time
        // reserved id — proving the placeholder was filled at execute.
        expect(inverse.payload.expectedDeviceIds).toEqual(['device-existing']);
    });

    it('executes the internal project writer with the provided payload', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', devices: [] }] });
        mocks.writeDeviceToProject.mockReturnValue({ id: 'device-1', parameterValues: {} });
        const result = handleAddDevice.execute({
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'EQ' },
        });

        expect(mocks.writeDeviceToProject).toHaveBeenCalledWith(
            't1',
            'EQ',
            undefined,
            expect.stringMatching(/^device-/),
            undefined,
            undefined
        );
        expect(result).toMatchObject({ status: 'written' });
    });

    it('returns no-write when the project writer rejects the target track', () => {
        mocks.writeDeviceToProject.mockReturnValue(null);
        const result = handleAddDevice.execute({
            type: 'addDevice',
            payload: { trackId: 'vca-1', deviceType: 'EQ' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description reflecting the device type', () => {
        const desc = handleAddDevice.describe({
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'EQ' },
        });
        expect(desc.label).toBe('Add EQ');
    });

    it('reserves an identity and describes an exact removal inverse', () => {
        const action = { type: 'addDevice', payload: { trackId: 't1', deviceType: 'builtin-eq' } } as const;

        const desc = handleAddDevice.describe(action);

        expect(desc.inverseAction).toEqual({
            type: 'removeDevice',
            payload: {
                deviceId: expect.stringMatching(/^device-/),
                // A bare add has no pre-declared chain: describe embeds an
                // empty placeholder so the compensation is guarded for atomic
                // batches, and execute finalizes it from the actual post-add
                // chain (shared by reference with the inverse payload).
                expectedTrackId: 't1',
                expectedDeviceIds: [],
            },
        });
    });

    it('is undoable', () => {
        expect(handleAddDevice.undoable).toBe(true);
    });

    it('defers the compiled runtime delta until the project commit succeeds', () => {
        const action = {
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'builtin-compressor', deviceId: 'device-1' },
        } as const;
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', devices: [] }] });
        mocks.writeDeviceToProject.mockReturnValue({ id: 'device-1', parameterValues: { threshold: -12 } });

        const result = handleAddDevice.execute(action);
        if (!result || result instanceof Promise || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred runtime effect');
        }

        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        result.afterCommit();
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'add-device' })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'device-1', 'threshold', -12);
        expect(handleAddDevice.requiresAbortCompensation).toBe(false);
    });

    it('commits a normal folder device without a live-strip runtime delta', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'folder-1', kind: 'folder', devices: [] }] });
        mocks.writeDeviceToProject.mockReturnValue({
            id: 'device-1',
            type: 'builtin-compressor',
            parameterValues: { threshold: -12 },
        });
        registerHandlerMap({ addDevice: handleAddDevice });

        await expect(
            executeAppAction({
                type: 'addDevice',
                payload: { trackId: 'folder-1', deviceType: 'builtin-compressor', deviceId: 'device-1' },
            })
        ).resolves.toBeUndefined();

        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('initializes a folder toaster strip and its eligible children after the project commit', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'folder-1', kind: 'folder', devices: [] },
                { id: 'child-1', kind: 'audio', parentId: 'folder-1', devices: [] },
            ],
        });
        mocks.writeDeviceToProject.mockReturnValue({
            id: 'toaster-1',
            type: 'toaster',
            parameterValues: { masterGain: 1.2 },
        });
        mocks.projectTrackToLiveStrip.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 1, projectRevision: 'project-1' },
            runtimeRevision: 2,
        });
        registerHandlerMap({ addDevice: handleAddDevice });

        await expect(
            executeAppAction({
                type: 'addDevice',
                payload: { trackId: 'folder-1', deviceType: 'toaster', deviceId: 'toaster-1' },
            })
        ).resolves.toBeUndefined();

        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(1, {
            trackId: 'folder-1',
            activateDormantExternalPlugins: true,
        });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenNthCalledWith(2, {
            trackId: 'child-1',
            activateDormantExternalPlugins: true,
        });
    });

    it.each([
        [
            'a rejected folder-strip initialization',
            { acceptance: 'rejected', application: 'not-applied', reason: 'runtime revision is stale' },
            'retry',
            0,
            1,
        ],
        [
            'a folder-strip initialization that needs reconciliation',
            {
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'failed',
                correlation: { appRevision: 3, projectRevision: 'project-3' },
                reason: 'child strip failed after partial publication',
                runtimeRevision: 4,
            },
            'repair',
            0,
            1,
        ],
        [
            'a rejected child-strip initialization',
            { acceptance: 'rejected', application: 'not-applied', reason: 'runtime revision is stale' },
            'retry',
            1,
            2,
        ],
        [
            'a child-strip initialization that needs reconciliation',
            {
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'failed',
                correlation: { appRevision: 3, projectRevision: 'project-3' },
                reason: 'child strip failed after partial publication',
                runtimeRevision: 4,
            },
            'repair',
            1,
            2,
        ],
    ])(
        'does not report clean command success after %s',
        async (_label, initializationResult, remediation, appliedInitializations, expectedProjectionCalls) => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    { id: 'folder-1', kind: 'folder', devices: [] },
                    { id: 'child-1', kind: 'audio', parentId: 'folder-1', devices: [] },
                ],
            });
            mocks.writeDeviceToProject.mockReturnValue({
                id: 'toaster-1',
                type: 'toaster',
                parameterValues: {},
            });
            for (let index = 0; index < appliedInitializations; index += 1) {
                mocks.projectTrackToLiveStrip.mockReturnValueOnce({
                    acceptance: 'accepted',
                    application: 'applied',
                    correlation: { appRevision: 1, projectRevision: 'project-1' },
                    runtimeRevision: 2,
                });
            }
            mocks.projectTrackToLiveStrip.mockReturnValueOnce(initializationResult);
            registerHandlerMap({ addDevice: handleAddDevice });

            const committedError = await executeAppAction({
                type: 'addDevice',
                payload: { trackId: 'folder-1', deviceType: 'toaster', deviceId: 'toaster-1' },
            }).then(
                () => {
                    throw new Error('Expected committed runtime initialization failure');
                },
                (error: unknown) => error
            );

            expect(isAppActionCommittedError(committedError)).toBe(true);
            if (
                !(committedError instanceof Error) ||
                !isAppActionCommittedError(committedError) ||
                !(committedError.cause instanceof AggregateError)
            ) {
                throw new Error('Expected the Command post-commit receipt to retain the initialization failure');
            }
            expect(committedError.cause.errors).toHaveLength(2);
            for (const runtimeFailure of committedError.cause.errors) {
                expect(runtimeFailure).toMatchObject({
                    name: 'RuntimeTrackStripInitializationPostCommitError',
                    outcome: initializationResult,
                    remediation,
                });
            }

            expect(undoStore.value?.past).toHaveLength(1);
            expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledTimes(expectedProjectionCalls);
        }
    );

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
    ])('does not report clean command success after %s', async (_label, runtimeResult, remediation) => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', devices: [] }] });
        mocks.writeDeviceToProject.mockReturnValue({ id: 'device-1', parameterValues: {} });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(runtimeResult);
        registerHandlerMap({ addDevice: handleAddDevice });

        const committedError = await executeAppAction({
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'builtin-compressor', deviceId: 'device-1' },
        }).then(
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

        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('reports clean command success when the same commit superseded the delta', async () => {
        // A later action in the same commit removed the host track, so the
        // chain delta is void and the parameter writes below it would target a
        // device on a track that no longer exists. Demanding manual repair for
        // it wedges any batch that adds a device and then drops its track.
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', devices: [] }] });
        mocks.writeDeviceToProject.mockReturnValue({ id: 'device-1', parameterValues: { threshold: -12 } });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(supersededAddDelta);
        registerHandlerMap({ addDevice: handleAddDevice });

        await expect(
            executeAppAction({
                type: 'addDevice',
                payload: { trackId: 't1', deviceType: 'builtin-compressor', deviceId: 'device-1' },
            })
        ).resolves.toBeUndefined();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('reports clean command success only after an applied runtime delta', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', devices: [] }] });
        mocks.writeDeviceToProject.mockReturnValue({ id: 'device-1', parameterValues: { threshold: -12 } });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        registerHandlerMap({ addDevice: handleAddDevice });

        await expect(
            executeAppAction({
                type: 'addDevice',
                payload: { trackId: 't1', deviceType: 'builtin-compressor', deviceId: 'device-1' },
            })
        ).resolves.toBeUndefined();

        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'device-1', 'threshold', -12);
    });
});
