import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
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

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: { loading: false, initialized: true } as ProjectStoreState },
    projectStoreSet: vi.fn(),
    createCrdtProject: vi.fn(),
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
    resumeDurableAssetOwnerHandoffsAfterProjectLoad: vi.fn(() => Promise.resolve()),
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
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: mocks.createCrdtProject,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    loadCrdtProject: mocks.loadCrdtProject,
    persistCrdtProject: mocks.persistCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    executeAppAction: mocks.executeAppAction,
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    migrateAbsoluteMidiNotes: vi.fn(),
    readLegacyChordTrackMigration: mocks.readLegacyChordTrackMigration,
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
        mocks.projectStoreValue.value = { loading: false, initialized: true } as ProjectStoreState;
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
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
        expect(mocks.migrateActiveProjectIdentity).toHaveBeenCalledTimes(1);
        expect(mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad).toHaveBeenCalledTimes(1);
        expect(mocks.projectCrdtToStores.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.migrateActiveProjectIdentity.mock.invocationCallOrder[0]!
        );
        expect(mocks.migrateActiveProjectIdentity.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.resumeDurableAssetOwnerHandoffsAfterProjectLoad.mock.invocationCallOrder[0]!
        );
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
        expect(clearUndoHistory).not.toHaveBeenCalled();
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
