import { type CheckpointArtifactRecord } from '../../models/CheckpointArtifact';

import { type CheckpointOwnerStateInput, checkpointOwnerCatalogState } from './checkpointOwnerCatalogState';
import {
    CHECKPOINT_ARTIFACT_STORE_NAME,
    CHECKPOINT_CATALOG_STORE_NAME,
    CHECKPOINT_OWNER_CATALOG_STORE_NAME,
    openDatabase,
} from './helpers';
import { normalizeCheckpointArtifactRecord } from './normalizeCheckpointArtifactRecord';
import { checkpointOwnerSnapshot } from './readCheckpointOwnerSnapshot';
import { requireCheckpointIdentity } from './requireCheckpointIdentity';

type CommitCheckpointCatalogInput = {
    ownerProjectId: string;
    expectedCatalogRevision: string | null;
    nextState: CheckpointOwnerStateInput;
    newArtifact?: CheckpointArtifactRecord;
};

export type CommitCheckpointCatalogOptions = {
    shouldCommit: () => boolean;
};

type CommitCheckpointCatalogResult =
    { status: 'committed'; catalogRevision: string } | { status: 'conflict' } | { status: 'superseded' };

function normalizeExpectedRevision(value: unknown): string | null {
    return value === null ? null : requireCheckpointIdentity(value, 'expectedCatalogRevision');
}

export async function commitCheckpointCatalog(
    input: CommitCheckpointCatalogInput,
    options: CommitCheckpointCatalogOptions
): Promise<CommitCheckpointCatalogResult> {
    const ownerProjectId = requireCheckpointIdentity(input.ownerProjectId, 'ownerProjectId');
    const expectedCatalogRevision = normalizeExpectedRevision(input.expectedCatalogRevision);
    const nextState = checkpointOwnerCatalogState.parseInput(input.nextState);
    const newArtifact = input.newArtifact ? normalizeCheckpointArtifactRecord(input.newArtifact) : undefined;
    if (newArtifact && newArtifact.ownerProjectId !== ownerProjectId) {
        throw new Error('[CheckpointPersistence] New checkpoint artifact belongs to another owner');
    }
    if (!options.shouldCommit()) {
        return { status: 'superseded' };
    }

    const database = await openDatabase();
    if (!database) {
        throw new Error('[CheckpointPersistence] IndexedDB is unavailable');
    }
    const transaction = database.transaction(
        [CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME, CHECKPOINT_OWNER_CATALOG_STORE_NAME],
        'readwrite'
    );
    const completion = checkpointOwnerSnapshot.transaction(transaction);
    try {
        const current = await checkpointOwnerSnapshot.read(transaction, ownerProjectId);
        if (!options.shouldCommit()) {
            try {
                transaction.abort();
            } catch {
                // The transaction already completed or aborted.
            }
            await completion.catch(() => undefined);
            return { status: 'superseded' };
        }
        const currentCatalogRevision = current.state?.catalogRevision ?? null;
        if (currentCatalogRevision !== expectedCatalogRevision) {
            await completion;
            return { status: 'conflict' };
        }

        const checkpoints = current.snapshot?.checkpoints ?? [];
        const proposedCheckpoints = newArtifact
            ? [...checkpoints, (({ rootBytes: _rootBytes, ...catalog }) => catalog)(newArtifact)]
            : checkpoints;
        checkpointOwnerCatalogState.validateGraph(nextState, proposedCheckpoints);

        if (newArtifact) {
            const { rootBytes, ...catalog } = newArtifact;
            transaction.objectStore(CHECKPOINT_ARTIFACT_STORE_NAME).add(
                {
                    checkpointId: newArtifact.checkpointId,
                    ownerProjectId,
                    rootBytes,
                },
                newArtifact.checkpointId
            );
            transaction.objectStore(CHECKPOINT_CATALOG_STORE_NAME).add(catalog, newArtifact.checkpointId);
        }

        const catalogRevision = crypto.randomUUID();
        transaction.objectStore(CHECKPOINT_OWNER_CATALOG_STORE_NAME).put(
            {
                ownerProjectId,
                catalogRevision,
                branches: nextState.branches.map((branch) => ({ ...branch })),
                currentBranchId: nextState.currentBranchId,
                currentCheckpointId: nextState.currentCheckpointId,
            },
            ownerProjectId
        );
        await completion;
        return { status: 'committed', catalogRevision };
    } catch (error) {
        try {
            transaction.abort();
        } catch {
            // The transaction already completed or aborted.
        }
        await completion.catch(() => undefined);
        throw error;
    }
}
