import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../../__tests__/fakeIndexedDb';
import { projectLoadFailureStore } from '../../../../stores/projectLoadFailureStore';
import { saveProject } from '../saveProject';

import type { ProjectStoreState } from '../../../../stores/projectStore';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: null as ProjectStoreState | null },
    projectStoreSet: vi.fn<(value: ProjectStoreState) => void>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
    captureProjectRevision: vi.fn<() => string>(),
    addToRecentProjects: vi.fn<(name: string, key: string) => void>(),
    loggerWarn: vi.fn<(...args: unknown[]) => void>(),
    notifyUser: vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>(),
    buildProjectData: vi.fn<() => Promise<{ data: unknown } | null>>(),
    migrateActiveProjectIdentity: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../../fileIO/buildProjectData', () => ({
    buildProjectData: mocks.buildProjectData,
}));
vi.mock('../../migrateActiveProjectIdentity', () => ({
    migrateActiveProjectIdentity: mocks.migrateActiveProjectIdentity,
}));

vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('../../../recentProjects/addToRecentProjects', () => ({
    addToRecentProjects: mocks.addToRecentProjects,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

function makeProject(): ProjectStoreState {
    return {
        name: 'My Song',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        dirty: true,
        loading: false,
    } as unknown as ProjectStoreState;
}

describe('saveProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        installFakeIndexedDb();
        mocks.projectStoreValue.value = makeProject();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.captureProjectRevision.mockReturnValue('saved-revision');
        mocks.buildProjectData.mockResolvedValue({ data: { version: 1, meta: { name: 'My Song' } } });
        mocks.migrateActiveProjectIdentity.mockResolvedValue(false);
        projectLoadFailureStore.set(null);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /**
     * `projectStore` names the project; the other stores hold its data. After a
     * load replaced the CRDT authority and then failed, those two disagree:
     * `projectStore` still carries the previous project's `createdAt` (its
     * metadata write was in the batch that never ran) while everything else
     * holds the projection default. A save then keys the recent entry to the
     * user's real project and writes the emptied stores into it.
     *
     * No user is needed to trigger it: `dirty` is still true and `stopPlayback`
     * already ran, so the 30 s autosave interval in `useAppInitialization`
     * fires on its own within half a minute of the failure surface appearing.
     */
    it('writes nothing while a failed load has left the stores unrelated to the project', async () => {
        projectLoadFailureStore.set({ message: 'session gone', projectName: 'Song B' });

        await expect(saveProject()).resolves.toBe(false);

        expect(mocks.buildProjectData).not.toHaveBeenCalled();
        expect(mocks.persistCrdtProject).not.toHaveBeenCalled();
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
        expect(mocks.projectStoreSet).not.toHaveBeenCalled();
    });

    it('keys the recent-project entry by the stable project id, not the display name', async () => {
        void saveProject();

        await vi.waitFor(() => {
            expect(mocks.addToRecentProjects).toHaveBeenCalledTimes(1);
        });
        const first_call = mocks.addToRecentProjects.mock.calls[0];
        if (!first_call) {
            throw new Error('expected an addToRecentProjects call');
        }
        const [, key] = first_call;
        // A rename changes name but not createdAt; the key must be stable across it.
        expect(key).toBe('sourdaw:project:1700000000000');
        expect(key).not.toContain('My Song');
    });

    it('finishes identity migration before building a versioned snapshot', async () => {
        let finishMigration: (() => void) | undefined;
        mocks.migrateActiveProjectIdentity.mockReturnValue(
            new Promise<boolean>((resolve) => {
                finishMigration = () => resolve(true);
            })
        );

        const saving = saveProject();
        expect(mocks.migrateActiveProjectIdentity).toHaveBeenCalledOnce();
        expect(mocks.buildProjectData).not.toHaveBeenCalled();

        finishMigration?.();
        await expect(saving).resolves.toBe(true);
        expect(mocks.buildProjectData).toHaveBeenCalledOnce();
    });

    it('does not record a recent-project entry when CRDT persistence rejects', async () => {
        mocks.persistCrdtProject.mockRejectedValue(new Error('disk full'));

        void saveProject();

        await vi.waitFor(() => {
            expect(mocks.loggerWarn).toHaveBeenCalled();
        });
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
    });

    it('records a recent-project entry only after CRDT persistence succeeds', async () => {
        let resolvePersist: (() => void) | undefined;
        mocks.persistCrdtProject.mockReturnValue(
            new Promise<void>((resolve) => {
                resolvePersist = resolve;
            })
        );

        void saveProject();

        // Not recorded synchronously before persistence settles.
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();

        resolvePersist?.();

        await vi.waitFor(() => {
            expect(mocks.addToRecentProjects).toHaveBeenCalledTimes(1);
        });
    });

    it('resolves true once persistence succeeds', async () => {
        await expect(saveProject()).resolves.toBe(true);
    });

    it('clears the dirty flag once persistence succeeds and the revision is unchanged', async () => {
        // Both captureProjectRevision calls (before and after persist) return
        // the same value, modelling a save with no concurrent edit.
        mocks.captureProjectRevision.mockReturnValue('same-revision');
        await saveProject();

        expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('keeps the dirty flag asserted when an edit lands during the snapshot write', async () => {
        // Models the genuine concurrent-edit case the guard exists for: after
        // persist settles (the revision is captured) a concurrent edit during
        // the async IndexedDB write advances the revision, so the snapshot is
        // stale and dirty must stay asserted for the next save.
        mocks.captureProjectRevision.mockReturnValueOnce('pre-write').mockReturnValueOnce('post-write');

        await saveProject();

        expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('notifies and resolves false when persistence fails', async () => {
        const failure = new Error('idb write failed');
        mocks.persistCrdtProject.mockRejectedValue(failure);

        await expect(saveProject()).resolves.toBe(false);

        expect(mocks.loggerWarn).toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Save failed — your latest changes could not be persisted.',
            'error'
        );
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
    });
});
