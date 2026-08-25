import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { installFakeIndexedDb } from '../../__tests__/fakeIndexedDb';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { loadProject } from '../projectPersistence/loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';
import { renameProject } from '../projectPersistence/saveProject/renameProject';
import { saveProject } from '../projectPersistence/saveProject/saveProject';

import type { ProjectStoreState } from '../../stores/projectStore';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: { loading: false, dirty: false, name: 'Initial' } as unknown as ProjectStoreState },
    projectStoreSet: vi.fn<(...args: unknown[]) => void>(),
    createCrdtProject: vi.fn<() => void>(),
    getCrdtDoc: vi.fn(),
    loadCrdtProject: vi.fn<(input?: { shouldCommit?: () => boolean }) => Promise<boolean>>(),
    projectCrdtToStores: vi.fn<() => void>(),
    startCrdtAutoSave: vi.fn<() => () => void>(() => vi.fn<() => void>()),
    clearUndoHistory: vi.fn<() => void>(),
    resetActionReplayAuthority: vi.fn<() => void>(),
    captureProjectRevision: vi.fn<() => string>(() => 'saved-revision'),
    persistCrdtProject: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    addToRecentProjects: vi.fn<(...args: unknown[]) => void>(),
    prepareCachedAudioBuffersFromIdb: vi.fn(),
    publishPreparedBuffers: vi.fn(() => 1),
    captureExternalPluginStates: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    buildProjectData: vi.fn<() => Promise<{ data: unknown } | null>>(),
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
    captureProjectRevision: mocks.captureProjectRevision,
    createCrdtProject: mocks.createCrdtProject,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    loadCrdtProject: mocks.loadCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    clearUndoHistory: mocks.clearUndoHistory,
    resetActionReplayAuthority: mocks.resetActionReplayAuthority,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        cancelPendingAudioBufferImport: vi.fn(),
        getAudioContext: vi.fn(() => ({})),
        prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
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
        vi.clearAllMocks();
        installFakeIndexedDb();
        mocks.buildProjectData.mockResolvedValue({ data: { version: 1, meta: { name: 'My Song' } } });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        mocks.projectStoreValue.value = {
            loading: false,
            dirty: false,
            name: 'Initial',
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
            expect(mocks.clearUndoHistory).toHaveBeenCalled();
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
            expect(mocks.clearUndoHistory).not.toHaveBeenCalled();
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
                name: 'My Song',
                createdAt: 1700000000000,
                dirty: true,
            } as unknown as ProjectStoreState;

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
