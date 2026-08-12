import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFromTemplate } from '../createFromTemplate';

const mocks = vi.hoisted(() => ({
    acquireRuntimeTransition: vi.fn(),
    clearUndoHistory: vi.fn(),
    compactProject: vi.fn(),
    createPopSongTemplate: vi.fn(),
    ensureTrackStrips: vi.fn(),
    executeAppAction: vi.fn(),
    isAppActionCommittedError: vi.fn(),
    flushAutomergeStorageWrites: vi.fn(),
    newProject: vi.fn(),
    unloadPlugin: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    projectSet: vi.fn(),
    resetAudioGraph: vi.fn(),
    resetCrdtProjectAuthority: vi.fn(),
    resetModuleStoresToDefault: vi.fn(),
    setAutoSaveHandle: vi.fn(),
    startCrdtAutoSave: vi.fn(),
    stopActiveAutoSave: vi.fn(),
    stopPlayback: vi.fn(),
    transactionActivate: vi.fn(),
    transactionCanActivate: vi.fn(),
    transactionIsCurrent: vi.fn(),
    transactionPrepare: vi.fn(),
    runProjectLoadTransaction: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: mocks.resetAudioGraph,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: mocks.unloadPlugin,
}));

vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: mocks.clearUndoHistory,
    executeAppAction: mocks.executeAppAction,
    isAppActionCommittedError: mocks.isAppActionCommittedError,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    compactProject: mocks.compactProject,
    projectActionHistoryToStore: mocks.projectActionHistoryToStore,
    resetCrdtProjectAuthority: mocks.resetCrdtProjectAuthority,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: mocks.ensureTrackStrips,
    stopPlayback: mocks.stopPlayback,
}));

vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return { ...actual, flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites };
});

vi.mock('../../../projectPersistence/newProject', () => ({
    newProject: mocks.newProject,
}));

vi.mock('../../../projectPersistence/helpers/autoSaveHandle', () => ({
    setAutoSaveHandle: mocks.setAutoSaveHandle,
}));

vi.mock('../../../projectPersistence/helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: mocks.resetModuleStoresToDefault,
}));

vi.mock('../../../projectPersistence/helpers/runProjectLoadTransaction', () => ({
    projectLoadEpoch: { acquireRuntimeTransition: mocks.acquireRuntimeTransition },
    runProjectLoadTransaction: mocks.runProjectLoadTransaction,
}));

vi.mock('../../../projectPersistence/helpers/stopActiveAutoSave', () => ({
    stopActiveAutoSave: mocks.stopActiveAutoSave,
}));

vi.mock('../../templateFiles/popSong', () => ({
    createPopSongTemplate: mocks.createPopSongTemplate,
}));

vi.mock('#/modules/Project/stores/projectStore', () => ({
    projectStore: {
        get value() {
            return { name: 'Pop Song', initialized: false, loading: true };
        },
        set: mocks.projectSet,
    },
}));

describe('createFromTemplate', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.createPopSongTemplate.mockResolvedValue(undefined);
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.isAppActionCommittedError.mockReturnValue(false);
        mocks.newProject.mockResolvedValue(true);
        mocks.unloadPlugin.mockResolvedValue(undefined);
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.acquireRuntimeTransition.mockResolvedValue(() => {});
        mocks.startCrdtAutoSave.mockReturnValue({});
        mocks.transactionPrepare.mockResolvedValue(true);
        mocks.transactionActivate.mockReturnValue(true);
        mocks.transactionIsCurrent.mockReturnValue(true);
        mocks.transactionCanActivate.mockReturnValue(true);
        mocks.runProjectLoadTransaction.mockReturnValue({
            prepare: mocks.transactionPrepare,
            activate: mocks.transactionActivate,
            isCurrent: mocks.transactionIsCurrent,
            canActivate: mocks.transactionCanActivate,
        });
    });

    it('rejects an unknown template before dispatch', async () => {
        const created = await createFromTemplate('unknown-template');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(created).toBe(false);
    });

    it('dispatches template construction through the action boundary', async () => {
        const created = await createFromTemplate('pop-song');

        expect(mocks.stopPlayback).toHaveBeenCalledOnce();
        expect(mocks.resetAudioGraph).toHaveBeenCalledOnce();
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'createProjectFromTemplate', payload: { templateId: 'pop-song' } },
            { skipMacroRecording: true }
        );
        const actionOrder = mocks.executeAppAction.mock.invocationCallOrder[0];
        const resetOrder = mocks.resetAudioGraph.mock.invocationCallOrder[0];
        if (actionOrder === undefined || resetOrder === undefined) {
            throw new Error('expected reset and template action calls');
        }
        expect(actionOrder).toBeGreaterThan(resetOrder);
        expect(mocks.createPopSongTemplate).not.toHaveBeenCalled();
        expect(created).toBe(true);
    });

    it('converts a rejected template action to a failed outcome', async () => {
        mocks.executeAppAction.mockRejectedValue(new Error('device setup failed'));

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();

        const recoveryResetOrder = mocks.resetAudioGraph.mock.invocationCallOrder[1];
        const rebuildOrder = mocks.ensureTrackStrips.mock.invocationCallOrder[0];
        if (recoveryResetOrder === undefined || rebuildOrder === undefined) {
            throw new Error('expected graph recovery calls');
        }
        expect(rebuildOrder).toBeGreaterThan(recoveryResetOrder);
    });

    it('recovers when initial graph reset throws after partial teardown', async () => {
        mocks.resetAudioGraph.mockImplementationOnce(() => {
            throw new Error('partial teardown');
        });

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('keeps recovery failures inside the boolean outcome boundary', async () => {
        mocks.executeAppAction.mockRejectedValue(new Error('action failed'));
        mocks.resetAudioGraph
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('recovery reset failed');
            });
        mocks.ensureTrackStrips.mockImplementationOnce(() => {
            throw new Error('strip rebuild failed');
        });

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
    });

    it('reports success when template truth committed before a degraded post-commit failure', async () => {
        const committedFailure = new Error('macro history failed after commit');
        mocks.executeAppAction.mockRejectedValue(committedFailure);
        mocks.isAppActionCommittedError.mockImplementation((error) => error === committedFailure);

        await expect(createFromTemplate('pop-song')).resolves.toBe(true);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
    });

    it('lets project-replacement templates own the CRDT authority swap', async () => {
        await expect(createFromTemplate('empty')).resolves.toBe(true);

        expect(mocks.newProject).toHaveBeenCalledOnce();
        expect(mocks.stopPlayback).not.toHaveBeenCalled();
        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.runProjectLoadTransaction).not.toHaveBeenCalled();
        expect(mocks.resetModuleStoresToDefault).not.toHaveBeenCalled();
    });

    it('runs the project-transition machinery before template construction', async () => {
        await expect(createFromTemplate('pop-song')).resolves.toBe(true);

        expect(mocks.transactionPrepare).toHaveBeenCalledOnce();
        expect(mocks.transactionActivate).toHaveBeenCalledOnce();
        expect(mocks.stopActiveAutoSave).toHaveBeenCalledOnce();
        expect(mocks.resetCrdtProjectAuthority).toHaveBeenCalledWith('Pop Song');
        expect(mocks.projectActionHistoryToStore).toHaveBeenCalledOnce();
        expect(mocks.resetModuleStoresToDefault).toHaveBeenCalledOnce();
        expect(mocks.clearUndoHistory).toHaveBeenCalledOnce();
        expect(mocks.startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(mocks.compactProject).toHaveBeenCalledOnce();

        // Transition machinery must land BEFORE the template action runs.
        const prepareOrder = mocks.transactionPrepare.mock.invocationCallOrder[0];
        const stopOrder = mocks.stopPlayback.mock.invocationCallOrder[0];
        const storeResetOrder = mocks.resetModuleStoresToDefault.mock.invocationCallOrder[0];
        const actionOrder = mocks.executeAppAction.mock.invocationCallOrder[0];
        const autosaveOrder = mocks.startCrdtAutoSave.mock.invocationCallOrder[0];
        if (
            prepareOrder === undefined ||
            stopOrder === undefined ||
            storeResetOrder === undefined ||
            actionOrder === undefined ||
            autosaveOrder === undefined
        ) {
            throw new Error('expected all transition steps to be called');
        }
        expect(stopOrder).toBeGreaterThan(prepareOrder);
        expect(storeResetOrder).toBeGreaterThan(stopOrder);
        expect(actionOrder).toBeGreaterThan(storeResetOrder);
        expect(autosaveOrder).toBeGreaterThan(actionOrder);
    });

    it('returns false without teardown when the transition is superseded', async () => {
        mocks.transactionPrepare.mockResolvedValue(false);

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);

        expect(mocks.stopPlayback).not.toHaveBeenCalled();
        expect(mocks.resetModuleStoresToDefault).not.toHaveBeenCalled();
        expect(mocks.clearUndoHistory).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('bails before any teardown when superseded mid-flight during stopPlayback', async () => {
        mocks.transactionIsCurrent.mockReturnValueOnce(false);

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);

        expect(mocks.stopPlayback).toHaveBeenCalledOnce();
        expect(mocks.stopActiveAutoSave).not.toHaveBeenCalled();
        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
        expect(mocks.resetCrdtProjectAuthority).not.toHaveBeenCalled();
        expect(mocks.resetModuleStoresToDefault).not.toHaveBeenCalled();
        expect(mocks.clearUndoHistory).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.startCrdtAutoSave).not.toHaveBeenCalled();
        expect(mocks.compactProject).not.toHaveBeenCalled();
    });

    it('does not replace authority when superseded during native teardown', async () => {
        const unloading = Promise.withResolvers<void>();
        mocks.unloadPlugin.mockReturnValueOnce(unloading.promise);
        mocks.transactionIsCurrent.mockReturnValueOnce(true).mockReturnValueOnce(false);

        const creation = createFromTemplate('pop-song');
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        unloading.resolve();

        await expect(creation).resolves.toBe(false);
        expect(mocks.resetCrdtProjectAuthority).not.toHaveBeenCalled();
    });
    it('holds the runtime transition lease through the template action', async () => {
        const action = Promise.withResolvers<void>();
        const releaseRuntimeTransition = vi.fn();
        mocks.acquireRuntimeTransition.mockResolvedValueOnce(releaseRuntimeTransition);
        mocks.executeAppAction.mockReturnValueOnce(action.promise);
        mocks.transactionIsCurrent.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);
        const creation = createFromTemplate('pop-song');
        await vi.waitFor(() => expect(mocks.executeAppAction).toHaveBeenCalledOnce());
        expect(releaseRuntimeTransition).not.toHaveBeenCalled();
        action.resolve();
        await expect(creation).resolves.toBe(false);
        expect(releaseRuntimeTransition).toHaveBeenCalledOnce();
    });

    it('flushes pending CRDT writes after the store reset and before the async template action', async () => {
        // CC-10 regression: the pre-build resetModuleStoresToDefault writes an
        // empty tracks slot to the CRDT-backed trackStore OUTSIDE the action
        // transaction, scheduling an unscoped requestAnimationFrame flush. Because
        // the template handler is async, that deferred empty write can land AFTER
        // the rebuilt tracks, reverting the projection to an empty "Untitled
        // Project". createFromTemplate must commit that teardown baseline (flush)
        // between the reset and the rebuild action so no stale write survives.
        await expect(createFromTemplate('pop-song')).resolves.toBe(true);

        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledOnce();

        const storeResetOrder = mocks.resetModuleStoresToDefault.mock.invocationCallOrder[0];
        const flushOrder = mocks.flushAutomergeStorageWrites.mock.invocationCallOrder[0];
        const actionOrder = mocks.executeAppAction.mock.invocationCallOrder[0];
        if (storeResetOrder === undefined || flushOrder === undefined || actionOrder === undefined) {
            throw new Error('expected the store reset, flush, and template action to all be called');
        }
        expect(flushOrder).toBeGreaterThan(storeResetOrder);
        expect(actionOrder).toBeGreaterThan(flushOrder);
    });

    it('publishes workspace-ready only after the template action commits, never during the async build', async () => {
        // CC-10 (ready-before-settle): initProject deliberately leaves the project
        // not-ready during the async build; createFromTemplate is the single seam
        // that latches workspace-ready (initialized: true) — and only AFTER the
        // template action's writes (tracks + selection) have committed, so a track
        // the user clicks the instant the workspace paints is not clobbered by the
        // template's late-landing setTrackState (devices.spec.ts:11 under load).
        await expect(createFromTemplate('pop-song')).resolves.toBe(true);

        const readyCallIndex = mocks.projectSet.mock.calls.findIndex(
            (call) => (call[0] as { initialized?: boolean } | undefined)?.initialized === true
        );
        expect(readyCallIndex).toBeGreaterThanOrEqual(0);

        const readyOrder = mocks.projectSet.mock.invocationCallOrder[readyCallIndex];
        const actionOrder = mocks.executeAppAction.mock.invocationCallOrder[0];
        if (readyOrder === undefined || actionOrder === undefined) {
            throw new Error('expected the template action and the ready latch to both run');
        }
        expect(readyOrder).toBeGreaterThan(actionOrder);
    });
});
