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
    flushAutomergeStorageWrites: vi.fn<() => void>(),
    migrateActiveProjectIdentity: vi.fn(() => Promise.resolve(false)),
    repairState: { value: null },
    writeNamedProjectJsonByKey: vi.fn<(key: string, json: string) => Promise<void>>(),
}));

vi.mock('../../fileIO/buildProjectData', () => ({
    buildProjectData: mocks.buildProjectData,
}));
vi.mock('../../migrateActiveProjectIdentity', () => ({
    migrateActiveProjectIdentity: mocks.migrateActiveProjectIdentity,
}));
vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
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
vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: mocks.repairState,
}));

vi.mock('../../../../repositories/project/writeNamedProjectJsonByKey', () => ({
    writeNamedProjectJsonByKey: mocks.writeNamedProjectJsonByKey,
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
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
        mocks.migrateActiveProjectIdentity.mockResolvedValue(false);
        mocks.repairState.value = null;
        mocks.writeNamedProjectJsonByKey.mockResolvedValue(undefined);
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

    it('rejects a snapshot when repair becomes required during CRDT persistence', async () => {
        let resolvePersist: (() => void) | undefined;
        mocks.persistCrdtProject.mockReturnValue(
            new Promise<void>((resolve) => {
                resolvePersist = resolve;
            })
        );

        const saving = saveProject();
        await vi.waitFor(() => {
            expect(mocks.persistCrdtProject).toHaveBeenCalledTimes(1);
        });
        mocks.repairState.value = {
            audioGraphValid: true,
            detectedRevision: 'repair-entered-during-crdt-persist',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [
                {
                    kind: 'repair-project-invariants',
                    targetIds: ['@project/raw/adjustmentLayers'],
                },
            ],
            status: 'repair-required',
        };
        resolvePersist?.();

        await expect(saving).resolves.toBe(false);
        expect(mocks.writeNamedProjectJsonByKey).not.toHaveBeenCalled();
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
        expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('rejects a snapshot when project truth changes after build while CRDT persistence is pending', async () => {
        let revision = 'built-revision';
        let resolvePersist: (() => void) | undefined;
        mocks.captureProjectRevision.mockImplementation(() => revision);
        mocks.persistCrdtProject.mockReturnValue(
            new Promise<void>((resolve) => {
                resolvePersist = resolve;
            })
        );

        const saving = saveProject();
        await vi.waitFor(() => {
            expect(mocks.persistCrdtProject).toHaveBeenCalledTimes(1);
        });

        revision = 'edited-revision';
        resolvePersist?.();

        await expect(saving).resolves.toBe(false);
        expect(mocks.writeNamedProjectJsonByKey).not.toHaveBeenCalled();
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
        expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('rejects completion when repair becomes required during the named snapshot write', async () => {
        let resolveWrite: (() => void) | undefined;
        mocks.writeNamedProjectJsonByKey.mockReturnValue(
            new Promise<void>((resolve) => {
                resolveWrite = resolve;
            })
        );

        const saving = saveProject();
        await vi.waitFor(() => {
            expect(mocks.writeNamedProjectJsonByKey).toHaveBeenCalledTimes(1);
        });
        mocks.repairState.value = {
            audioGraphValid: true,
            detectedRevision: 'repair-entered-during-named-snapshot-write',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [
                {
                    kind: 'repair-project-invariants',
                    targetIds: ['@project/raw/adjustmentLayers'],
                },
            ],
            status: 'repair-required',
        };
        resolveWrite?.();

        await expect(saving).resolves.toBe(false);
        expect(mocks.writeNamedProjectJsonByKey).toHaveBeenCalledTimes(1);
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
        expect(mocks.projectStoreSet).not.toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('resolves true once persistence succeeds', async () => {
        await expect(saveProject()).resolves.toBe(true);
    });

    it('clears the dirty flag once persistence succeeds and the revision is unchanged', async () => {
        // Every revision capture returns the same value, modelling a save with
        // no concurrent edit before or during either durable write.
        mocks.captureProjectRevision.mockReturnValue('same-revision');
        await saveProject();

        expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
    });

    it('rejects a committed snapshot that became stale during the named JSON write', async () => {
        let revision = 'snapshot-revision';
        let resolveWrite: (() => void) | undefined;
        mocks.captureProjectRevision.mockImplementation(() => revision);
        mocks.writeNamedProjectJsonByKey.mockReturnValue(
            new Promise<void>((resolve) => {
                resolveWrite = resolve;
            })
        );

        const saving = saveProject();
        await vi.waitFor(() => {
            expect(mocks.writeNamedProjectJsonByKey).toHaveBeenCalledTimes(1);
        });
        revision = 'post-write-revision';
        resolveWrite?.();

        await expect(saving).resolves.toBe(false);
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
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
