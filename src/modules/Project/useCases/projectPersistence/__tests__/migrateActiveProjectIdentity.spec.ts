import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../../models/ProductionBrief';
import { isCanonicalProjectId } from '../../../models/ProjectData';
import { migrateActiveProjectIdentity } from '../migrateActiveProjectIdentity';

import type { ProjectStoreState } from '../../../stores/projectStore';

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    persistCrdtProject: vi.fn(() => Promise.resolve()),
    project: { value: null as ProjectStoreState | null },
    projectSet: vi.fn<(value: ProjectStoreState) => void>(),
}));

vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    persistCrdtProject: mocks.persistCrdtProject,
}));
vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.project.value;
        },
        set: mocks.projectSet,
    },
}));

function legacyProject(projectId?: string): ProjectStoreState {
    return {
        projectId,
        identityMigrationPending: false,
        name: 'Legacy Project',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        dirty: false,
        loading: true,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: { name: 'Equal Temperament', frequencies: Array.from({ length: 128 }, () => 440) },
        productionBrief: createDefaultProductionBrief(1_700_000_000_000),
        initialized: false,
    };
}

describe('migrateActiveProjectIdentity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.persistCrdtProject.mockReset();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.project.value = null;
        mocks.projectSet.mockImplementation((value) => {
            mocks.project.value = value;
        });
    });

    it('persists distinct identities for same-createdAt missing and malformed live CRDT projections', async () => {
        mocks.project.value = legacyProject();
        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);
        const missingIdentity = mocks.project.value?.projectId;

        mocks.project.value = legacyProject('not-a-uuid');
        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);
        const malformedIdentity = mocks.project.value?.projectId;

        expect(isCanonicalProjectId(missingIdentity)).toBe(true);
        expect(isCanonicalProjectId(malformedIdentity)).toBe(true);
        expect(missingIdentity).not.toBe(malformedIdentity);
        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledTimes(2);
        expect(mocks.persistCrdtProject).toHaveBeenCalledTimes(2);
        expect(mocks.projectSet.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.flushAutomergeStorageWrites.mock.invocationCallOrder[0]!
        );
        expect(mocks.flushAutomergeStorageWrites.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.persistCrdtProject.mock.invocationCallOrder[0]!
        );
    });

    it('keeps the candidate unpublished while persistence is pending', async () => {
        let finishPersistence: (() => void) | undefined;
        mocks.project.value = legacyProject();
        mocks.persistCrdtProject.mockReturnValue(
            new Promise<void>((resolve) => {
                finishPersistence = resolve;
            })
        );

        const migrating = migrateActiveProjectIdentity();
        await vi.waitFor(() => expect(mocks.persistCrdtProject).toHaveBeenCalledOnce());

        expect(mocks.project.value).toMatchObject({ identityMigrationPending: true });
        expect(isCanonicalProjectId(mocks.project.value?.projectId)).toBe(true);

        finishPersistence?.();
        await expect(migrating).resolves.toBe(true);
        expect(mocks.project.value).toMatchObject({ identityMigrationPending: false });
    });

    it('restores a retryable noncanonical projection when persistence rejects', async () => {
        const failure = new Error('quota refused');
        mocks.project.value = legacyProject('not-a-uuid');
        mocks.persistCrdtProject.mockRejectedValue(failure);

        await expect(migrateActiveProjectIdentity()).rejects.toBe(failure);

        expect(mocks.project.value).toMatchObject({
            projectId: 'not-a-uuid',
            identityMigrationPending: false,
        });
        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent callers onto one durable migration', async () => {
        let finishPersistence: (() => void) | undefined;
        mocks.project.value = legacyProject();
        mocks.persistCrdtProject.mockReturnValue(
            new Promise<void>((resolve) => {
                finishPersistence = resolve;
            })
        );

        const first = migrateActiveProjectIdentity();
        const second = migrateActiveProjectIdentity();
        await vi.waitFor(() => expect(mocks.persistCrdtProject).toHaveBeenCalledOnce());
        finishPersistence?.();

        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(mocks.persistCrdtProject).toHaveBeenCalledOnce();
    });

    it('publishes only the successful retry identity after a rejected attempt', async () => {
        const failure = new Error('first persistence failed');
        mocks.project.value = legacyProject();
        mocks.persistCrdtProject.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);

        await expect(migrateActiveProjectIdentity()).rejects.toBe(failure);
        const rejectedCandidate = mocks.projectSet.mock.calls.find(
            ([value]) => value.identityMigrationPending && isCanonicalProjectId(value.projectId)
        )?.[0].projectId;

        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);
        const publishedIds = mocks.projectSet.mock.calls
            .map(([value]) => value)
            .filter((value) => !value.identityMigrationPending && isCanonicalProjectId(value.projectId))
            .map((value) => value.projectId);

        expect(isCanonicalProjectId(rejectedCandidate)).toBe(true);
        expect(publishedIds).toHaveLength(1);
        expect(publishedIds[0]).not.toBe(rejectedCandidate);
        expect(mocks.project.value).toMatchObject({
            projectId: publishedIds[0],
            identityMigrationPending: false,
        });
    });

    it('is idempotent once the active project has a canonical identity', async () => {
        mocks.project.value = legacyProject('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

        await expect(migrateActiveProjectIdentity()).resolves.toBe(false);

        expect(mocks.projectSet).not.toHaveBeenCalled();
        expect(mocks.flushAutomergeStorageWrites).not.toHaveBeenCalled();
        expect(mocks.persistCrdtProject).not.toHaveBeenCalled();
    });
});
