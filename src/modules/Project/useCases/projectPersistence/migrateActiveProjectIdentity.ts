import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases';

import { createProjectId, isCanonicalProjectId } from '../../models/ProjectData';
import { projectStore, type ProjectStoreState } from '../../stores/projectStore';

type ActiveIdentityMigration = {
    candidateProjectId: string;
    promise: Promise<boolean>;
};

let activeIdentityMigration: ActiveIdentityMigration | null = null;

type PersistIdentityMigrationInput = {
    project: ProjectStoreState;
    previousProjectId: string | undefined;
    candidateProjectId: string;
};

async function persistIdentityMigration({
    project,
    previousProjectId,
    candidateProjectId,
}: PersistIdentityMigrationInput): Promise<boolean> {
    projectStore.set({
        ...project,
        projectId: candidateProjectId,
        identityMigrationPending: true,
    });

    try {
        flushAutomergeStorageWrites();
        await persistCrdtProject();
    } catch (error) {
        const current = projectStore.value;
        if (current?.identityMigrationPending && current.projectId === candidateProjectId) {
            projectStore.set({
                ...current,
                projectId: previousProjectId,
                identityMigrationPending: false,
            });
            try {
                flushAutomergeStorageWrites();
            } catch (rollbackError) {
                throw new AggregateError([error, rollbackError], 'Project identity migration and rollback failed', {
                    cause: rollbackError,
                });
            }
        }
        throw error;
    }

    const current = projectStore.value;
    if (current?.identityMigrationPending && current.projectId === candidateProjectId) {
        projectStore.set({ ...current, identityMigrationPending: false });
    }
    return true;
}

/**
 * Give one projected legacy project a durable canonical identity.
 *
 * Projection itself remains read-only and may expose an absent identity. This
 * explicit load/save seam mints once, commits the store write into the active
 * Automerge document, and persists that document before a version-2 snapshot
 * or canonical address can be published.
 */
export function migrateActiveProjectIdentity(): Promise<boolean> {
    const project = projectStore.value;
    if (!project || (isCanonicalProjectId(project.projectId) && !project.identityMigrationPending)) {
        return Promise.resolve(false);
    }

    if (
        activeIdentityMigration &&
        project.identityMigrationPending &&
        project.projectId === activeIdentityMigration.candidateProjectId
    ) {
        return activeIdentityMigration.promise;
    }

    const previousProjectId = project.identityMigrationPending ? undefined : project.projectId;
    const candidateProjectId =
        project.identityMigrationPending && isCanonicalProjectId(project.projectId)
            ? project.projectId
            : createProjectId();
    const deferred = Promise.withResolvers<boolean>();
    const migration: ActiveIdentityMigration = {
        candidateProjectId,
        promise: deferred.promise,
    };
    activeIdentityMigration = migration;

    void (async () => {
        try {
            deferred.resolve(await persistIdentityMigration({ project, previousProjectId, candidateProjectId }));
        } catch (error) {
            deferred.reject(error);
        } finally {
            if (activeIdentityMigration === migration) {
                activeIdentityMigration = null;
            }
        }
    })();

    return migration.promise;
}
