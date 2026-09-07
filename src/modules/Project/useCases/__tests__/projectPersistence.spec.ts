import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { installFakeIndexedDb } from '../../__tests__/fakeIndexedDb';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { loadProject } from '../projectPersistence/loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';
import { renameProject } from '../projectPersistence/saveProject/renameProject';
import { saveProject } from '../projectPersistence/saveProject/saveProject';

import type { ProjectStoreState } from '../../stores/projectStore';
import type { BuiltProjectData } from '../projectPersistence/fileIO/buildProjectData';

const { emit } = vi.hoisted(() => ({
    emit: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
    projectStoreValue: {
        value: {
            dirty: false,
            identityMigrationPending: false,
            identityPersistencePending: false,
            initialized: true,
            loading: false,
            name: 'Initial',
            projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        } as unknown as ProjectStoreState,
    },
    projectStoreSet: vi.fn<(...args: unknown[]) => void>(),
    createCrdtProject: vi.fn<() => void>(),
    getCrdtDoc: vi.fn(),
    loadCrdtProject: vi.fn<(input?: { shouldCommit?: () => boolean }) => Promise<boolean>>(),
    projectCrdtToStores: vi.fn<() => void>(),
    startCrdtAutoSave: vi.fn<() => () => void>(() => vi.fn<() => void>()),
    reconcileSessionUndoForProject:
        vi.fn<(target: { projectId: string | undefined; captureWitness: () => string }) => void>(),
    resetActionReplayAuthority: vi.fn<() => void>(),
    executeAppAction: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    captureProjectRevision: vi.fn<() => string>(() => 'saved-revision'),
    captureDurableDocumentWitness: vi.fn<() => string>(() => 'document-witness'),
    persistCrdtProject: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    addToRecentProjects: vi.fn<(...args: unknown[]) => void>(),
    prepareCachedAudioBuffersFromIdb: vi.fn(),
    publishPreparedBuffers: vi.fn(() => 1),
    captureExternalPluginStates: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    buildProjectData: vi.fn<() => Promise<BuiltProjectData | null>>(),
    getDurableProjectOwnerId: vi.fn<() => string>(() => 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa'),
    migrateAbsoluteMidiNotes: vi.fn<() => void>(),
    readLegacyChordTrackMigration: vi.fn(),
    ensureCachedAudioBuffersDurable: vi.fn(() =>
        Promise.resolve({ status: 'durable' as const, isCurrent: () => true, release: vi.fn() })
    ),
}));

// Mock the dependencies of the use cases we are testing
vi.mock('../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));

// For saveProject.ts (nested two levels down from projectPersistence/)
// it imports from ../../../stores/projectStore which is correct.
// But when we test it from __tests__/, it's different.
// Vitest mocks should use the same path as the import in the source file.

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureDurableDocumentWitness: mocks.captureDurableDocumentWitness,
    captureProjectRevision: mocks.captureProjectRevision,
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
    executeUserAppAction: vi.fn(),
    executeAppAction: mocks.executeAppAction,
    executeAppActionBatch: vi.fn(),
    reconcileSessionUndoForProject: mocks.reconcileSessionUndoForProject,
    resetActionReplayAuthority: mocks.resetActionReplayAuthority,
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    migrateAbsoluteMidiNotes: mocks.migrateAbsoluteMidiNotes,
    readLegacyChordTrackMigration: mocks.readLegacyChordTrackMigration,
    adaptGrooveTemplateForConsumer: vi.fn(),
    appendMidiNotes: vi.fn(),
    arpeggiate: vi.fn(),
    canPrepareMidiClipGlueState: vi.fn(),
    downloadMidiFile: vi.fn(),
    duplicateClipNotes: vi.fn(),
    duplicateMidiClipData: vi.fn(),
    getChordAtBeat: vi.fn(),
    getGrooveTemplate: vi.fn(),
    getMidiInputTrack: vi.fn(),
    getMidiInputTrackOwnerId: vi.fn(),
    getMidiInputTrackRevision: vi.fn(),
    getMidiStoreState: vi.fn(),
    getScopedGrooveAssignment: vi.fn(),
    getScopedGrooveConsumerId: vi.fn(),
    getStraightGrooveTemplateId: vi.fn(),
    hasActiveStepRecordingDependency: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    mergeImportedMidiClipNotes: vi.fn(),
    midiClipGlueStateMatches: vi.fn(),
    midiClipSplitStateMatches: vi.fn(),
    panicLiveNotes: vi.fn(),
    prepareMidiClipGlueState: vi.fn(),
    prepareMidiClipSplit: vi.fn(),
    projectClipMidiEvents: vi.fn(),
    projectCommittedGroove: vi.fn(),
    projectMidiNotesByClipIdThroughRestores: vi.fn(() => ({})),
    readMidiFile: vi.fn(),
    removeMidiClipData: vi.fn(),
    resetMidiState: vi.fn(),
    resetMidiStoreForProject: vi.fn(),
    resolveMidiNoteArticulationId: vi.fn(),
    restoreGrooveAssignment: vi.fn(),
    restoreMidiClipData: vi.fn(),
    restoreMidiClipGlueState: vi.fn(),
    restoreMidiClipNotes: vi.fn(),
    restoreMidiClipSplitState: vi.fn(),
    serializeMidiStateForClips: vi.fn(),
    setMidiInputTrack: vi.fn(),
    setNotesForClip: vi.fn(),
    shouldPlayMidiEvent: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
    transposeForChordTrack: vi.fn(),
}));
vi.mock('../getDurableProjectOwnerId', () => ({
    getDurableProjectOwnerId: mocks.getDurableProjectOwnerId,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        cancelPendingAudioBufferImport: vi.fn(),
        getAudioContext: vi.fn(() => ({})),
        prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
        ensureCachedAudioBuffersDurable: mocks.ensureCachedAudioBuffersDurable,
    };
});

// Relative to saveProject.ts: ../../recentProjects/addToRecentProjects
vi.mock('../recentProjects/addToRecentProjects', () => ({
    addToRecentProjects: mocks.addToRecentProjects,
}));

// captureExternalPluginStates has its own dedicated spec; stub it here so this
// suite stays focused on persist / recent-projects behaviour.
vi.mock('../projectPersistence/saveProject/captureExternalPluginStates', () => ({
    captureExternalPluginStates: mocks.captureExternalPluginStates,
}));

// The snapshot serializer needs a hydrated arrangement to produce anything, and
// since ADR 0013 saveProject reports failure when it produces nothing. Stub it
// so this suite exercises the persistence sequencing rather than serialization.
vi.mock('../projectPersistence/fileIO/buildProjectData', () => ({
    buildProjectData: mocks.buildProjectData,
}));

describe('Project Persistence Use Cases', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: { emit } });
        emit.mockClear();
        vi.clearAllMocks();
        installFakeIndexedDb();
        mocks.buildProjectData.mockResolvedValue({
            data: { version: 1, meta: { name: 'My Song' } } as BuiltProjectData['data'],
            missingBufferCount: 0,
            requiredAudioBufferIds: [],
            snapshotRevision: 'saved-revision',
        });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        mocks.projectStoreValue.value = {
            loading: false,
            dirty: false,
            identityMigrationPending: false,
            identityPersistencePending: false,
            initialized: true,
            name: 'Initial',
            projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        } as unknown as ProjectStoreState;
        mocks.getCrdtDoc.mockReturnValue({
            tracks: {
                tracks: [
                    {
                        clips: [{ audioBufferId: 'active-buffer' }],
                        alternatives: [],
                        freezeState: { status: 'unfrozen' },
                    },
                ],
            },
        });
        mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({
            cancel: vi.fn(),
            publish: mocks.publishPreparedBuffers,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('loadProject', () => {
        it('lands on the launch screen without auto-creating when persistence reports absence', async () => {
            mocks.projectStoreValue.value = {
                loading: true,
                dirty: false,
                name: 'Untitled Project',
                initialized: false,
            } as unknown as ProjectStoreState;
            mocks.loadCrdtProject.mockResolvedValue(false);

            await expect(loadProject()).resolves.toBe(false);

            expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
            expect(mocks.loadCrdtProject.mock.calls[0]?.[0]?.shouldCommit).toBeTypeOf('function');
            expect(mocks.createCrdtProject).not.toHaveBeenCalled();
            expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
            // Loading clears so AppShell renders the LaunchScreen; initialized stays false.
            expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ loading: false }));
            expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ initialized: true }));
        });

        it('loads CRDT and hydrates stores without publishing an abortable loading state', async () => {
            mocks.loadCrdtProject.mockResolvedValue(true);

            await loadProject();

            expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ loading: true }));
            expect(mocks.loadCrdtProject).toHaveBeenCalled();
            expect(mocks.prepareCachedAudioBuffersFromIdb).toHaveBeenCalledWith(
                expect.objectContaining({ bufferIds: ['active-buffer'] })
            );
            expect(mocks.publishPreparedBuffers.mock.invocationCallOrder[0]).toBeLessThan(
                mocks.projectCrdtToStores.mock.invocationCallOrder[0]!
            );
            expect(mocks.projectCrdtToStores).toHaveBeenCalled();
            expect(mocks.reconcileSessionUndoForProject).toHaveBeenCalledWith({
                projectId: mocks.projectStoreValue.value.projectId,
                captureWitness: mocks.captureDurableDocumentWitness,
            });
            expect(mocks.startCrdtAutoSave).toHaveBeenCalled();
        });

        it('does not create or mutate a replacement project when persistence rejects', async () => {
            const persistenceFailure = new Error('[CrdtPersistence] Failed to open IndexedDB');
            mocks.loadCrdtProject.mockRejectedValue(persistenceFailure);

            await expect(loadProject()).rejects.toThrow(persistenceFailure);

            expect(mocks.createCrdtProject).not.toHaveBeenCalled();
            expect(mocks.getCrdtDoc).not.toHaveBeenCalled();
            expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
            expect(mocks.persistCrdtProject).not.toHaveBeenCalled();
            expect(mocks.prepareCachedAudioBuffersFromIdb).not.toHaveBeenCalled();
            expect(mocks.reconcileSessionUndoForProject).not.toHaveBeenCalled();
            expect(mocks.startCrdtAutoSave).not.toHaveBeenCalled();
        });

        it('rejects before post-recovery migrations when durable owner recovery fails', async () => {
            const recoveryFailure = new Error('durable owner recovery failed');
            const removeLegacyChordMigration = vi.fn();
            mocks.loadCrdtProject.mockResolvedValue(true);
            mocks.readLegacyChordTrackMigration.mockReturnValue({
                action: { type: 'migrateLegacyChordTrack' },
                remove: removeLegacyChordMigration,
            });
            setProjectIdentityTransitionDependencies({
                leaveCollaborationSession: () => Promise.resolve(),
                resumeDurableAssetOwnerHandoffsAfterProjectLoad: () => Promise.reject(recoveryFailure),
            });

            await expect(loadProject()).rejects.toThrow(recoveryFailure);

            expect(mocks.readLegacyChordTrackMigration).not.toHaveBeenCalled();
            expect(mocks.executeAppAction).not.toHaveBeenCalled();
            expect(mocks.persistCrdtProject).not.toHaveBeenCalled();
            expect(removeLegacyChordMigration).not.toHaveBeenCalled();
            expect(mocks.startCrdtAutoSave).not.toHaveBeenCalled();
        });

        it('returns benign false without creating a project when a newer load cancels it', async () => {
            mocks.loadCrdtProject.mockImplementationOnce(async () => {
                const newerLoad = runProjectLoadTransaction();
                await newerLoad.prepare();
                newerLoad.activate();
                return false;
            });

            await expect(loadProject()).resolves.toBe(false);

            expect(mocks.createCrdtProject).not.toHaveBeenCalled();
            expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
        });
    });

    describe('saveProject', () => {
        it('persists CRDT and updates store metadata', async () => {
            mocks.projectStoreValue.value = {
                ...mocks.projectStoreValue.value,
                name: 'My Song',
                createdAt: 1700000000000,
                dirty: true,
            };

            const savePromise = saveProject();

            // Native plugin state is captured into project truth before persistence,
            // so persistCrdtProject() now runs after that async capture step rather
            // than synchronously. Wait for the save to settle, then assert effects.
            await savePromise;

            expect(mocks.captureExternalPluginStates).toHaveBeenCalled();
            expect(mocks.persistCrdtProject).toHaveBeenCalled();
            expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));

            // The recent-projects entry is recorded once persistence resolves, keyed
            // by the stable per-project createdAt (sourdaw:project:<createdAt>), not
            // the mutable display name.
            expect(mocks.addToRecentProjects).toHaveBeenCalledWith('My Song', 'sourdaw:project:1700000000000');
        });
    });

    describe('renameProject', () => {
        it('updates name and marks dirty', () => {
            renameProject('New Name');
            expect(mocks.projectStoreSet).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'New Name',
                    dirty: true,
                })
            );
        });
    });
});
