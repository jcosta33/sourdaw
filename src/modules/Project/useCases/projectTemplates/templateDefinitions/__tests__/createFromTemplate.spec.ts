import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectStore, type ProjectStoreState } from '../../../../stores/projectStore';
import { createFromTemplate } from '../createFromTemplate';

const mocks = vi.hoisted(() => ({
    acquireRuntimeTransition: vi.fn(),
    clearUndoHistory: vi.fn(),
    compactProject: vi.fn(),
    createPopSongTemplate: vi.fn(),
    ensureTrackStrips: vi.fn(),
    executeAppAction: vi.fn(),
    forgetProjectLatchedPedals: vi.fn(),
    isAppActionCommittedError: vi.fn(),
    flushAutomergeStorageWrites: vi.fn(),
    newProject: vi.fn(),
    unloadPlugin: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    projectSet: vi.fn(),
    resetAudioGraph: vi.fn(),
    resetCrdtProject: vi.fn(),
    finalize: vi.fn(),
    /** The last value written through the project store double. */
    projectState: { value: null as Partial<ProjectStoreState> | null },
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

// ../helpers is mocked so this spec does not load the template catalog / Nebula Drift demo.
vi.mock('../helpers', () => ({
    templates: [
        {
            id: 'empty',
            executionBoundary: 'project-replacement',
            create: () => mocks.newProject('Untitled'),
        },
        {
            id: 'pop-song',
            name: 'Pop Song',
            executionBoundary: 'app-action',
            create: mocks.createPopSongTemplate,
        },
    ],
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    forgetProjectLatchedPedals: mocks.forgetProjectLatchedPedals,
    resetAudioGraph: mocks.resetAudioGraph,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: mocks.unloadPlugin,
    activateExternalPlugin: vi.fn(),
    findSupportedPlugin: vi.fn(),
    registerFaustDSP: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: mocks.clearUndoHistory,
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
    isAppActionCommittedError: mocks.isAppActionCommittedError,
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(),
    compactProject: mocks.compactProject,
    createCrdtDoc: vi.fn(),
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
    beginBranchSession: vi.fn(),
    projectActionHistoryToStore: mocks.projectActionHistoryToStore,
    removeCrdtDoc: vi.fn(),
    projectBranchSession: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    resetCrdtProject: mocks.resetCrdtProject,
    resetCrdtProjectAuthority: vi.fn(),
    endBranchSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: mocks.ensureTrackStrips,
    stopPlayback: mocks.stopPlayback,
    addTempoChange: vi.fn(),
    addTimeSignatureChange: vi.fn(),
    defaultTransportState: {},
    replaceTempoMap: vi.fn(),
    replaceTimeSignatureMap: vi.fn(),
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

// Writes through, unlike a fixed getter: the durability barrier this file
// pins is the LAST write to the store, and a double that forgets every write
// cannot tell a raised barrier from a missing one.
vi.mock('#/modules/Project/stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectState.value;
        },
        set: mocks.projectSet,
    },
}));

describe('createFromTemplate', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.projectState.value = { name: 'Pop Song', initialized: false, loading: true };
        mocks.projectSet.mockImplementation((next: Partial<ProjectStoreState>) => {
            mocks.projectState.value = next;
        });
        mocks.createPopSongTemplate.mockResolvedValue(undefined);
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.isAppActionCommittedError.mockReturnValue(false);
        mocks.newProject.mockResolvedValue(true);
        mocks.unloadPlugin.mockResolvedValue(undefined);
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.finalize.mockResolvedValue('finalized');
        // A replacing reset always reports the point of no return, so the
        // default has to as well: every `authorityReplaced` branch depends on it.
        mocks.resetCrdtProject.mockImplementation((_name: string, onAuthorityReplaced?: () => void) => {
            onAuthorityReplaced?.();
            return Promise.resolve({ status: 'replaced', finalize: mocks.finalize });
        });
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

    /**
     * C4 — the action ran past the authority switch, so the previous project is
     * out of the stores: `ensureTrackStrips` reads a track store the projection
     * reset just emptied, and rebuilding from it would only look like a
     * recovery while autosave compacted the half-built template over the user's
     * project on disk.
     */
    it('converts a rejected template action to a failed outcome without a false recovery', async () => {
        mocks.executeAppAction.mockRejectedValue(new Error('device setup failed'));
        // The build died before any snapshot, so nothing of the template
        // reached storage and the reset cannot finalize.
        mocks.finalize.mockResolvedValue('authority-mismatch');

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);
        expect(mocks.resetAudioGraph).toHaveBeenCalledOnce();
        expect(mocks.ensureTrackStrips).not.toHaveBeenCalled();
        expect(mocks.startCrdtAutoSave).not.toHaveBeenCalled();
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
        // Fails before the authority switch, which is the only point at which
        // there is a previous project left to rebuild.
        mocks.unloadPlugin.mockRejectedValue(new Error('native teardown failed'));
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
        expect(mocks.resetCrdtProject).not.toHaveBeenCalled();
    });

    /**
     * C4 — the template's writes did commit, so this project is the one the
     * user keeps: its branch list has to become durable and autosave has to
     * protect it from here. The previous project's graph is not restored, which
     * past the switch would only look like a recovery.
     */
    it('reports success when template truth committed before a degraded post-commit failure', async () => {
        const committedFailure = new Error('macro history failed after commit');
        mocks.executeAppAction.mockRejectedValue(committedFailure);
        mocks.isAppActionCommittedError.mockImplementation((error) => error === committedFailure);

        await expect(createFromTemplate('pop-song')).resolves.toBe(true);
        expect(mocks.resetAudioGraph).toHaveBeenCalledOnce();
        expect(mocks.ensureTrackStrips).not.toHaveBeenCalled();
        expect(mocks.finalize).toHaveBeenCalledOnce();
        expect(mocks.startCrdtAutoSave).toHaveBeenCalledOnce();
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
        expect(mocks.resetCrdtProject).toHaveBeenCalledWith('Pop Song', expect.any(Function));
        // The template owns the document from that call on, so the pedals
        // latched under the project just left are forgotten here and not at the
        // earlier graph reset, which restoreAudioGraph can still undo.
        expect(mocks.forgetProjectLatchedPedals).toHaveBeenCalledOnce();
        expect(mocks.forgetProjectLatchedPedals.mock.invocationCallOrder[0]!).toBeGreaterThan(
            mocks.resetCrdtProject.mock.invocationCallOrder[0]!
        );
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
        // C3 — the template is not the durable project until the reset is
        // finalized, so autosave must not run before that answer.
        const compactionOrder = mocks.compactProject.mock.invocationCallOrder[0]!;
        const finalizeOrder = mocks.finalize.mock.invocationCallOrder[0]!;
        expect(finalizeOrder).toBeGreaterThan(compactionOrder);
        expect(autosaveOrder).toBeGreaterThan(finalizeOrder);
    });

    // C1 — every refusal is decided before the switch, so the previous project
    // is still the live one and this is an ordinary abort.
    it('restores the previous project when the reset is refused', async () => {
        mocks.resetCrdtProject.mockResolvedValue({ status: 'refused', reason: 'reset-active' });

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);

        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
        expect(mocks.startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(mocks.compactProject).not.toHaveBeenCalled();
        expect(mocks.finalize).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    // C2 — nothing of the template reached storage, so the reset cannot
    // finalize and autosave must stay stopped: starting it would compact the
    // half-built template over the user's own project on disk.
    it('leaves autosave stopped when the initial snapshot fails to persist', async () => {
        mocks.compactProject.mockRejectedValue(new Error('initial compaction failed'));
        mocks.finalize.mockResolvedValue('authority-mismatch');

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);

        expect(mocks.finalize).toHaveBeenCalledOnce();
        expect(mocks.startCrdtAutoSave).not.toHaveBeenCalled();
    });

    /**
     * C8 — the template is published either way, so an unfinalized reset
     * leaves a clean-looking workspace over storage that still holds the
     * previous project. The durability barrier is what stops a recovery caller
     * from closing that session, and only the normal save path clears it.
     */
    it('marks the template not durable when the reset cannot finalize', async () => {
        mocks.finalize.mockResolvedValue('authority-mismatch');

        await expect(createFromTemplate('pop-song')).resolves.toBe(true);

        expect(mocks.finalize).toHaveBeenCalledOnce();
        expect(projectStore.value?.identityPersistencePending).toBe(true);
        expect(projectStore.value?.initialized).toBe(true);
        expect(mocks.startCrdtAutoSave).not.toHaveBeenCalled();
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
        expect(mocks.resetCrdtProject).not.toHaveBeenCalled();
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
        expect(mocks.resetCrdtProject).not.toHaveBeenCalled();
        // The player stays in the old project, whose graph restoreAudioGraph
        // rebuilds above, so a damper still held must survive the abandoned
        // template creation.
        expect(mocks.forgetProjectLatchedPedals).not.toHaveBeenCalled();
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
