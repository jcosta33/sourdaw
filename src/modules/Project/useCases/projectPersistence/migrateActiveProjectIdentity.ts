import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases';

import { deriveDeterministicProjectId, isCanonicalProjectId } from '../../models/ProjectData';
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
    isSuperseded: () => boolean;
};

async function persistIdentityMigration({
    project,
    previousProjectId,
    candidateProjectId,
    isSuperseded,
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

    // What this seam owes its caller is a canonical identity in the projection,
    // not this attempt's authorship of it. A concurrent migration deriving the
    // same deterministic candidate, or a collaboration host forcing its own
    // identity into `projectMeta`, reaches the same destination; asking whether
    // *this* write is still the visible one reports a fatal save failure over a
    // project that is fully migrated.
    //
    // `readSettledProjectId` is the same contract for a persisted snapshot, but
    // it also demands `initialized: true`. This seam runs inside `loadProject`
    // and inside a save that precedes it, while the project is still loading, so
    // the condition is stated directly here: canonical, and not left pending.
    if (current && isCanonicalProjectId(current.projectId)) {
        if (current.identityMigrationPending && !isSuperseded()) {
            // Nothing else is in flight to publish the identity now standing in
            // the projection, so settling it is this attempt's job whether or
            // not the id is the one it minted.
            projectStore.set({ ...current, identityMigrationPending: false });
        }
        return true;
    }

    // A successor migration owns the projection now; its own settlement
    // publishes the identity, and this attempt is spent rather than failed.
    if (isSuperseded()) {
        return true;
    }

    // Nothing superseded this migration, and the projection carries no
    // canonical identity at all: the store write was discarded while
    // persistence was in flight — an ambient action transaction aborted it, or
    // a document-origin projection rebased over it. The project still carries
    // its legacy identity, so reporting success here hands `saveProject` a
    // projection `buildProjectData` refuses, and the user sees a save fail
    // against a snapshot error that never names identity.
    throw new Error('[migrateActiveProjectIdentity] Minted project identity did not survive persistence');
}

/**
 * Give one projected legacy project a durable canonical identity.
 *
 * Projection itself remains read-only and may expose an absent identity. This
 * explicit load/save seam mints once, commits the store write into the active
 * Automerge document, and persists that document before a version-2 snapshot
 * or canonical address can be published.
 *
 * The candidate is derived deterministically from the legacy document's
 * durable meta — its previous identity slot (absent or malformed) and its
 * `createdAt` — rather than minted at random. Both inputs are replicated CRDT
 * content, so two peers migrating the same converged legacy document mint the
 * SAME candidate and converge instead of persisting divergent owners. No
 * random fallback is needed: `createdAt` is required store state, so a stable
 * per-document seed always exists at this seam.
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
            : deriveDeterministicProjectId(project.projectId ?? '', String(project.createdAt));
    const deferred = Promise.withResolvers<boolean>();
    const migration: ActiveIdentityMigration = {
        candidateProjectId,
        promise: deferred.promise,
    };
    activeIdentityMigration = migration;

    void (async () => {
        try {
            deferred.resolve(
                await persistIdentityMigration({
                    project,
                    previousProjectId,
                    candidateProjectId,
                    isSuperseded: () => activeIdentityMigration !== migration,
                })
            );
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
