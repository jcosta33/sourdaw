import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    loadCrdtProject,
    persistCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';

import { projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import { runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';
import { resetProjectIdentityTransitionDependencies } from '../resetProjectIdentityTransitionDependencies';

const CANONICAL_PROJECT_ID = '405e744b-dead-843a-9395-86fdcd66368c';

const mocks = vi.hoisted(() => ({
    projectStoreValue: {
        value: {
            projectId: '405e744b-dead-843a-9395-86fdcd66368c',
            loading: false,
            identityMigrationPending: false,
            identityPersistencePending: false,
            initialized: true,
        } as ProjectStoreState,
    },
    projectStoreSet: vi.fn(),
    createCrdtProject: vi.fn(),
    reconcileSessionUndoForProject: vi.fn(),
    captureDurableDocumentWitness: vi.fn(() => 'document-witness'),
    executeAppAction: vi.fn<
        (
            action: unknown,
            options?: { shouldExecute?: () => boolean; skipMacroRecording?: boolean; skipUndo?: boolean }
        ) => Promise<void>
    >(() => Promise.resolve()),
    getCrdtDoc: vi.fn((): { chordTrack?: unknown; tracks: { tracks: never[] } } => ({ tracks: { tracks: [] } })),
    loadCrdtProject: vi.fn(),
    persistCrdtProject: vi.fn(() => Promise.resolve()),
    projectCrdtToStores: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    cancelPreparedBuffers: vi.fn(),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: vi.fn(), publish: vi.fn() })),
    resetModuleStores: vi.fn(),
    readLegacyChordTrackMigration: vi.fn(),
    resumeDurableAssetOwnerHandoffsAfterProjectLoad: vi.fn(
        (_authority: { ownerId: string; isCurrent: () => boolean; signal: AbortSignal }) => Promise.resolve()
    ),
    stopActiveAutoSave: vi.fn(),
    setAutoSaveHandle: vi.fn(),
    migrateActiveProjectIdentity: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureDurableDocumentWitness: mocks.captureDurableDocumentWitness,
    captureProjectRevision: vi.fn(),
    createCrdtDoc: vi.fn(),
    createCrdtProject: mocks.createCrdtProject,
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    loadCrdtProject: mocks.loadCrdtProject,
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: mocks.persistCrdtProject,
    preserveBranchStateForSession: vi.fn(),
    projectCrdtToStores: mocks.projectCrdtToStores,
    removeCrdtDoc: vi.fn(),
    replaceBranchState: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    replaceCrdtDocInLineage: vi.fn(),
    restoreBranchStateAfterSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({
    reconcileSessionUndoForProject: mocks.reconcileSessionUndoForProject,
    executeAppAction: mocks.executeAppAction,
    executeAppActionBatch: vi.fn(),
    executeUserAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    appendMidiNotes: vi.fn(),
    arpeggiate: vi.fn(),
    canPrepareMidiClipGlueState: vi.fn(),
    downloadMidiFile: vi.fn(),
    duplicateClipNotes: vi.fn(),
    duplicateMidiClipData: vi.fn(),
    getMidiInputTrack: vi.fn(),
    getMidiInputTrackOwnerId: vi.fn(),
    getMidiInputTrackRevision: vi.fn(),
    getMidiStoreState: vi.fn(),
    hasActiveStepRecordingDependency: vi.fn(),
    mergeImportedMidiClipNotes: vi.fn(),
    migrateAbsoluteMidiNotes: vi.fn(),
    midiClipGlueStateMatches: vi.fn(),
    midiClipSplitStateMatches: vi.fn(),
    prepareMidiClipGlueState: vi.fn(),
    prepareMidiClipSplit: vi.fn(),
    projectMidiNotesByClipIdThroughRestores: vi.fn(() => ({})),
    readLegacyChordTrackMigration: mocks.readLegacyChordTrackMigration,
    readMidiFile: vi.fn(),
    removeMidiClipData: vi.fn(),
    restoreMidiClipData: vi.fn(),
    restoreMidiClipGlueState: vi.fn(),
    restoreMidiClipNotes: vi.fn(),
    restoreMidiClipSplitState: vi.fn(),
    serializeMidiStateForClips: vi.fn(),
    setMidiInputTrack: vi.fn(),
    setNotesForClip: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
}));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: mocks.resetModuleStores }));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: mocks.stopActiveAutoSave }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: mocks.setAutoSaveHandle }));
vi.mock('../migrateActiveProjectIdentity', () => ({
    migrateActiveProjectIdentity: mocks.migrateActiveProjectIdentity,
}));

describe('loadProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = {
            projectId: CANONICAL_PROJECT_ID,
            loading: false,
            identityMigrationPending: false,
            identityPersistencePending: false,
            initialized: true,
        } as ProjectStoreState;
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.createCrdtProject.mockResolvedValue(undefined);
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.getCrdtDoc.mockReturnValue({ tracks: { tracks: [] } });
        mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({
            cancel: mocks.cancelPreparedBuffers,
            publish: vi.fn(),
        });
        mocks.readLegacyChordTrackMigration.mockReturnValue(null);
        mocks.migrateActiveProjectIdentity.mockResolvedValue(false);
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => Promise.resolve(),
            resumeDurableAssetOwnerHandoffsAfterProjectLoad: mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad,
        });
    });

    it('should hydrate only after collaboration exits and persistence activates', async () => {
        await expect(loadProject()).resolves.toBe(true);

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(mocks.resetModuleStores).toHaveBeenCalledWith({
            resetGrooveTemplates: false,
            resetMidiState: false,
            resetYeastState: false,
        });
        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(mocks.reconcileSessionUndoForProject).toHaveBeenCalledTimes(1);
        expect(mocks.reconcileSessionUndoForProject).toHaveBeenCalledWith({
            projectId: CANONICAL_PROJECT_ID,
            captureWitness: mocks.captureDurableDocumentWitness,
        });
        expect(mocks.projectCrdtToStores.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.reconcileSessionUndoForProject.mock.invocationCallOrder[0]!
        );
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
        expect(mocks.migrateActiveProjectIdentity).toHaveBeenCalledTimes(1);
        expect(mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad).toHaveBeenCalledTimes(1);
        expect(mocks.projectCrdtToStores.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.migrateActiveProjectIdentity.mock.invocationCallOrder[0]!
        );
        expect(mocks.migrateActiveProjectIdentity.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad.mock.invocationCallOrder[0]!
        );
        const recoveryAuthority = mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad.mock.calls[0]?.[0];
        expect(recoveryAuthority?.ownerId).toBe(CANONICAL_PROJECT_ID);
        expect(recoveryAuthority?.isCurrent()).toBe(true);
        expect(recoveryAuthority?.signal.aborted).toBe(false);
    });

    it('lands on the launch screen without creating a document when persistence is empty', async () => {
        mocks.loadCrdtProject.mockResolvedValue(false);

        await expect(loadProject()).resolves.toBe(false);

        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        // Loading is cleared so AppShell can present the LaunchScreen.
        expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ loading: false }));
    });

    it('should preserve the current project when persistence loading fails', async () => {
        const failure = new Error('sanitization failed');
        mocks.loadCrdtProject.mockRejectedValue(failure);

        await expect(loadProject()).rejects.toBe(failure);

        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
        expect(mocks.reconcileSessionUndoForProject).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(projectStore.set).not.toHaveBeenCalled();
    });

    it('should ignore an older load that resolves after a newer load', async () => {
        let resolveFirst: ((loaded: boolean) => void) | undefined;
        let resolveSecond: ((loaded: boolean) => void) | undefined;
        mocks.loadCrdtProject
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveSecond = resolve;
                    })
            );

        const first = loadProject();
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(1));
        const second = loadProject();
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(2));
        resolveSecond?.(true);
        await expect(second).resolves.toBe(true);
        resolveFirst?.(true);
        await expect(first).resolves.toBe(false);

        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });

    it('should abort before repository load when collaboration shutdown fails', async () => {
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => Promise.reject(new Error('shutdown failed')),
        });

        await expect(loadProject()).resolves.toBe(false);

        expect(loadCrdtProject).not.toHaveBeenCalled();
        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
    });

    it('does not take the unconfigured leave path while identity-transition deps are withheld', async () => {
        resetProjectIdentityTransitionDependencies();
        const leaveCollaborationSession = vi.fn(() => Promise.resolve());

        const loading = loadProject();
        let settled: boolean | 'pending' = 'pending';
        void loading.then((value) => {
            settled = value;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(settled).toBe('pending');
        expect(loadCrdtProject).not.toHaveBeenCalled();

        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession,
            resumeDurableAssetOwnerHandoffsAfterProjectLoad: mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad,
        });

        await expect(loading).resolves.toBe(true);
        expect(leaveCollaborationSession).toHaveBeenCalledOnce();
        expect(loadCrdtProject).toHaveBeenCalledOnce();
    });

    it('removes validated legacy chord data only after its restore action commits', async () => {
        let resolveCommit: (() => void) | undefined;
        const remove = vi.fn();
        const action = {
            type: 'restoreChordTrackState' as const,
            payload: {
                expected: { enabled: false, events: [] },
                replacement: { enabled: true, events: [] },
            },
        };
        mocks.readLegacyChordTrackMigration.mockReturnValue({ action, remove });
        mocks.executeAppAction.mockReturnValue(
            new Promise<void>((resolve) => {
                resolveCommit = resolve;
            })
        );

        const loading = loadProject();
        await vi.waitFor(() => expect(executeAppAction).toHaveBeenCalledOnce());
        expect(mocks.executeAppAction.mock.calls[0]?.[0]).toEqual(action);
        expect(mocks.executeAppAction.mock.calls[0]?.[1]).toMatchObject({
            skipMacroRecording: true,
            skipUndo: true,
        });
        expect(mocks.executeAppAction.mock.calls[0]?.[1]?.shouldExecute).toBeTypeOf('function');
        expect(persistCrdtProject).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        resolveCommit?.();

        await expect(loading).resolves.toBe(true);
        expect(persistCrdtProject).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledOnce();
    });

    it('does not read or overwrite legacy chord data when CRDT truth already exists', async () => {
        mocks.getCrdtDoc.mockReturnValue({ tracks: { tracks: [] }, chordTrack: { enabled: false, events: {} } });

        await expect(loadProject()).resolves.toBe(true);

        expect(mocks.readLegacyChordTrackMigration).not.toHaveBeenCalled();
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('preserves legacy chord data when the CRDT restore commit fails', async () => {
        const failure = new Error('commit failed');
        const remove = vi.fn();
        mocks.readLegacyChordTrackMigration.mockReturnValue({
            action: {
                type: 'restoreChordTrackState',
                payload: {
                    expected: { enabled: false, events: [] },
                    replacement: { enabled: true, events: [] },
                },
            },
            remove,
        });
        mocks.executeAppAction.mockRejectedValue(failure);

        await expect(loadProject()).rejects.toBe(failure);
        expect(persistCrdtProject).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it('preserves legacy chord data when durable CRDT persistence fails', async () => {
        const failure = new Error('persistence failed');
        const remove = vi.fn();
        mocks.readLegacyChordTrackMigration.mockReturnValue({
            action: {
                type: 'restoreChordTrackState',
                payload: {
                    expected: { enabled: false, events: [] },
                    replacement: { enabled: true, events: [] },
                },
            },
            remove,
        });
        mocks.persistCrdtProject.mockRejectedValue(failure);

        await expect(loadProject()).rejects.toBe(failure);
        expect(remove).not.toHaveBeenCalled();
    });

    it('invalidates owner recovery authority when a newer project transition supersedes the loaded identity', async () => {
        const recoveryGate = Promise.withResolvers<void>();
        let recoveryAuthority: { ownerId: string; isCurrent: () => boolean; signal: AbortSignal } | undefined;
        mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad.mockImplementationOnce((authority) => {
            recoveryAuthority = authority;
            return recoveryGate.promise;
        });

        const loading = loadProject();
        await vi.waitFor(() => expect(recoveryAuthority?.isCurrent()).toBe(true));
        const newerLoad = runProjectLoadTransaction({ yieldToInFlight: true });
        await newerLoad.prepare();
        newerLoad.activate();

        expect(recoveryAuthority?.isCurrent()).toBe(false);
        expect(recoveryAuthority?.signal.aborted).toBe(true);
        recoveryGate.resolve();
        await expect(loading).resolves.toBe(false);
    });

    it('reports a superseded load rather than a boot failure when a project transition breaks the identity migration', async () => {
        const migrationGate = Promise.withResolvers<boolean>();
        mocks.migrateActiveProjectIdentity.mockReturnValueOnce(migrationGate.promise);

        const loading = loadProject();
        await vi.waitFor(() => expect(mocks.migrateActiveProjectIdentity).toHaveBeenCalledTimes(1));

        // The user picks another legacy project off the LaunchScreen while the
        // boot restore's migration is persisting. That transition republishes
        // `projectMeta` wholesale, so the migration finds no canonical identity
        // and nothing it recognises as a successor, and throws.
        const newerLoad = runProjectLoadTransaction({ yieldToInFlight: true });
        await newerLoad.prepare();
        newerLoad.activate();
        migrationGate.reject(new Error('Minted project identity did not survive persistence'));

        await expect(loading).resolves.toBe(false);
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
    });

    it('fails the load when the identity migration throws and this project is still the current one', async () => {
        const failure = new Error('Minted project identity did not survive persistence');
        mocks.migrateActiveProjectIdentity.mockRejectedValueOnce(failure);

        await expect(loadProject()).rejects.toBe(failure);

        expect(startCrdtAutoSave).not.toHaveBeenCalled();
    });

    it('cancels a prepared buffer candidate when a newer project load supersedes it before publication', async () => {
        mocks.prepareCachedAudioBuffersFromIdb.mockImplementationOnce(async () => {
            const newerLoad = runProjectLoadTransaction();
            await newerLoad.prepare();
            newerLoad.activate();
            return { cancel: mocks.cancelPreparedBuffers, publish: vi.fn() };
        });

        await expect(loadProject()).resolves.toBe(false);

        expect(mocks.cancelPreparedBuffers).toHaveBeenCalledOnce();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
    });
});
