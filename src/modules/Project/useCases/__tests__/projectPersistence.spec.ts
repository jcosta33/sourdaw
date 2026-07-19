import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    persistCrdtProject: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    addToRecentProjects: vi.fn<(...args: unknown[]) => void>(),
    prepareCachedAudioBuffersFromIdb: vi.fn(),
    publishPreparedBuffers: vi.fn(() => 1),
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
    createCrdtProject: mocks.createCrdtProject,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    loadCrdtProject: mocks.loadCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('#/modules/Command/useCases', () => ({
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

describe('Project Persistence Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
        mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: mocks.publishPreparedBuffers });
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

            saveProject();

            // persistCrdtProject() is kicked off synchronously...
            expect(mocks.persistCrdtProject).toHaveBeenCalled();
            // ...but the recent-projects entry is only recorded once persistence
            // resolves (inside the .then()), and is keyed by the stable per-project
            // createdAt, not the mutable display name. So it has not happened yet.
            expect(mocks.addToRecentProjects).not.toHaveBeenCalled();

            await vi.waitFor(() => {
                expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
            });

            // After the persist promise flushes, the entry is recorded against the
            // createdAt-keyed id (sourdaw:project:<createdAt>), not the name.
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
