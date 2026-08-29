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
        mocks.flushAutomergeStorageWrites.mockReset();
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
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

    it('starts a distinct migration when a successor legacy project supersedes a pending one', async () => {
        const firstPersistence = Promise.withResolvers<void>();
        const secondPersistence = Promise.withResolvers<void>();
        mocks.persistCrdtProject
            .mockReturnValueOnce(firstPersistence.promise)
            .mockReturnValueOnce(secondPersistence.promise);
        mocks.project.value = legacyProject('first-invalid-id');

        const first = migrateActiveProjectIdentity();
        const firstCandidate = mocks.project.value?.projectId;
        expect(mocks.project.value).toMatchObject({ identityMigrationPending: true });

        mocks.project.value = {
            ...legacyProject('second-invalid-id'),
            name: 'Successor Legacy Project',
        };
        const second = migrateActiveProjectIdentity();
        const secondCandidate = mocks.project.value?.projectId;

        firstPersistence.resolve();
        await expect(first).resolves.toBe(true);
        const successorAfterFirstSettles = structuredClone(mocks.project.value);

        secondPersistence.resolve();
        await expect(second).resolves.toBe(true);

        expect(mocks.persistCrdtProject).toHaveBeenCalledTimes(2);
        expect(isCanonicalProjectId(firstCandidate)).toBe(true);
        expect(isCanonicalProjectId(secondCandidate)).toBe(true);
        expect(secondCandidate).not.toBe(firstCandidate);
        expect(successorAfterFirstSettles).toMatchObject({
            name: 'Successor Legacy Project',
            projectId: secondCandidate,
            identityMigrationPending: true,
        });
        expect(mocks.project.value).toMatchObject({
            name: 'Successor Legacy Project',
            projectId: secondCandidate,
            identityMigrationPending: false,
        });
    });

    it('does not let a rejected superseded migration roll back its successor', async () => {
        const firstPersistence = Promise.withResolvers<void>();
        const secondPersistence = Promise.withResolvers<void>();
        mocks.persistCrdtProject
            .mockReturnValueOnce(firstPersistence.promise)
            .mockReturnValueOnce(secondPersistence.promise);
        mocks.project.value = legacyProject('first-invalid-id');

        const first = migrateActiveProjectIdentity();

        mocks.project.value = {
            ...legacyProject('second-invalid-id'),
            name: 'Successor Legacy Project',
        };
        const second = migrateActiveProjectIdentity();
        const successorCandidate = mocks.project.value?.projectId;
        expect(isCanonicalProjectId(successorCandidate)).toBe(true);

        const firstFailure = new Error('superseded persistence failed');
        firstPersistence.reject(firstFailure);
        await expect(first).rejects.toBe(firstFailure);
        expect(mocks.project.value).toMatchObject({
            name: 'Successor Legacy Project',
            projectId: successorCandidate,
            identityMigrationPending: true,
        });

        secondPersistence.resolve();
        await expect(second).resolves.toBe(true);
        expect(mocks.project.value).toMatchObject({
            name: 'Successor Legacy Project',
            projectId: successorCandidate,
            identityMigrationPending: false,
        });
    });

    it('restores the original projection when the first CRDT flush throws and permits retry', async () => {
        const failure = new Error('CRDT flush failed');
        mocks.project.value = legacyProject('not-a-uuid');
        mocks.flushAutomergeStorageWrites.mockImplementationOnce(() => {
            throw failure;
        });

        await expect(migrateActiveProjectIdentity()).rejects.toBe(failure);

        expect(mocks.project.value).toMatchObject({
            projectId: 'not-a-uuid',
            identityMigrationPending: false,
        });
        expect(mocks.persistCrdtProject).not.toHaveBeenCalled();

        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);
        expect(isCanonicalProjectId(mocks.project.value?.projectId)).toBe(true);
        expect(mocks.project.value).toMatchObject({ identityMigrationPending: false });
        expect(mocks.persistCrdtProject).toHaveBeenCalledOnce();
    });

    it('republishes the same deterministic identity when a rejected attempt is retried', async () => {
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

        // The rejected candidate was never persisted, so the retry derives the
        // same deterministic identity from the unchanged legacy projection.
        expect(isCanonicalProjectId(rejectedCandidate)).toBe(true);
        expect(publishedIds).toEqual([rejectedCandidate]);
        expect(mocks.project.value).toMatchObject({
            projectId: rejectedCandidate,
            identityMigrationPending: false,
        });
    });

    it('mints the same candidate for two replicas migrating the same converged legacy document', async () => {
        mocks.project.value = legacyProject();
        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);
        const firstReplicaIdentity = mocks.project.value?.projectId;

        // A second peer projecting the identical converged legacy document:
        // same durable meta, same absent identity slot.
        mocks.project.value = legacyProject();
        await expect(migrateActiveProjectIdentity()).resolves.toBe(true);
        const secondReplicaIdentity = mocks.project.value?.projectId;

        expect(isCanonicalProjectId(firstReplicaIdentity)).toBe(true);
        expect(secondReplicaIdentity).toBe(firstReplicaIdentity);
    });

    it('resolves both attempts when an aborted transaction lets a second migration settle the same identity', async () => {
        const firstPersistence = Promise.withResolvers<void>();
        const secondPersistence = Promise.withResolvers<void>();
        mocks.persistCrdtProject
            .mockReturnValueOnce(firstPersistence.promise)
            .mockReturnValueOnce(secondPersistence.promise);
        mocks.project.value = legacyProject();

        const first = migrateActiveProjectIdentity();
        const candidate = mocks.project.value?.projectId;

        // The action transaction that owned the first attempt's store write
        // aborts: the scoped write is discarded and the projection reverts to
        // the legacy identity, so the pending-migration dedupe no longer sees
        // the attempt still in flight.
        mocks.project.value = legacyProject();
        const second = migrateActiveProjectIdentity();

        // `createdAt` never changes, so the second attempt derives the SAME
        // deterministic candidate — and its write is unscoped, so it lands.
        expect(isCanonicalProjectId(candidate)).toBe(true);
        expect(mocks.project.value).toMatchObject({ projectId: candidate, identityMigrationPending: true });

        firstPersistence.resolve();
        await expect(first).resolves.toBe(true);

        secondPersistence.resolve();
        await expect(second).resolves.toBe(true);
        expect(mocks.project.value).toMatchObject({ projectId: candidate, identityMigrationPending: false });
    });

    it('settles a canonical identity another writer published into the projection', async () => {
        const hostProjectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const persistence = Promise.withResolvers<void>();
        mocks.persistCrdtProject.mockReturnValueOnce(persistence.promise);
        mocks.project.value = legacyProject();

        const migrating = migrateActiveProjectIdentity();
        // A collaboration host forces its own canonical identity into
        // `projectMeta` while this persistence is in flight; the document-origin
        // projection carries it into the store and preserves the transient
        // pending flag this migration set.
        mocks.project.value = {
            ...legacyProject(),
            projectId: hostProjectId,
            identityMigrationPending: true,
        };

        persistence.resolve();
        await expect(migrating).resolves.toBe(true);
        expect(mocks.project.value).toMatchObject({
            projectId: hostProjectId,
            identityMigrationPending: false,
        });
    });

    it('reports a superseded attempt as spent when its own write was discarded', async () => {
        const firstPersistence = Promise.withResolvers<void>();
        const secondPersistence = Promise.withResolvers<void>();
        mocks.persistCrdtProject
            .mockReturnValueOnce(firstPersistence.promise)
            .mockReturnValueOnce(secondPersistence.promise);
        mocks.project.value = legacyProject();

        const first = migrateActiveProjectIdentity();
        // The action transaction owning the first attempt's store write aborts,
        // so the projection reverts to the legacy identity and a successor
        // migration takes ownership of the seam.
        mocks.project.value = legacyProject();
        const second = migrateActiveProjectIdentity();
        // The successor's write is discarded the same way, so when the first
        // persistence resolves the projection carries no canonical identity at
        // all — and the successor, not this spent attempt, owes its publication.
        mocks.project.value = legacyProject();

        firstPersistence.resolve();
        await expect(first).resolves.toBe(true);

        // The successor is the one that must report the discarded write.
        secondPersistence.resolve();
        await expect(second).rejects.toThrow('Minted project identity did not survive persistence');
    });

    it('reports failure when a discarded write leaves a malformed legacy identity in the projection', async () => {
        const persistence = Promise.withResolvers<void>();
        mocks.persistCrdtProject.mockReturnValueOnce(persistence.promise);
        mocks.project.value = legacyProject('not-a-uuid');

        const migrating = migrateActiveProjectIdentity();
        expect(isCanonicalProjectId(mocks.project.value?.projectId)).toBe(true);
        // The minted write is discarded while persistence is in flight. The
        // projection is not empty — it carries the malformed version-1 id it
        // always had — so presence alone cannot tell a migrated projection from
        // this one, and reporting success hands `saveProject` a projection
        // `buildProjectData` refuses.
        mocks.project.value = legacyProject('not-a-uuid');

        persistence.resolve();
        await expect(migrating).rejects.toThrow('Minted project identity did not survive persistence');
        expect(mocks.project.value).toMatchObject({ projectId: 'not-a-uuid' });
    });

    it('is idempotent once the active project has a canonical identity', async () => {
        mocks.project.value = legacyProject('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

        await expect(migrateActiveProjectIdentity()).resolves.toBe(false);

        expect(mocks.projectSet).not.toHaveBeenCalled();
        expect(mocks.flushAutomergeStorageWrites).not.toHaveBeenCalled();
        expect(mocks.persistCrdtProject).not.toHaveBeenCalled();
    });
});
