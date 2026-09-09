import { type CheckpointArtifactRecord } from '../../models/CheckpointArtifact';

import { combineCheckpointPair } from './combineCheckpointPair';
import {
    CHECKPOINT_ARTIFACT_STORE_NAME,
    CHECKPOINT_CATALOG_STORE_NAME,
    CHECKPOINT_OWNER_CATALOG_STORE_NAME,
    openDatabase,
} from './helpers';
import { checkpointOwnerSnapshot } from './readCheckpointOwnerSnapshot';
import { requireCheckpointIdentity } from './requireCheckpointIdentity';

function readStoredOwnerProjectId(value: unknown, field: string): string | null {
    if (value === undefined) {
        return null;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`[CheckpointPersistence] ${field} entry must be a record`);
    }
    return requireCheckpointIdentity((value as Record<string, unknown>).ownerProjectId, `${field} ownerProjectId`);
}

export async function readCheckpointArtifact(
    checkpointId: string,
    ownerProjectId: string
): Promise<CheckpointArtifactRecord | null> {
    const normalizedCheckpointId = requireCheckpointIdentity(checkpointId, 'checkpointId');
    const normalizedOwnerProjectId = requireCheckpointIdentity(ownerProjectId, 'ownerProjectId');
    const database = await openDatabase();
    if (!database) {
        throw new Error('[CheckpointPersistence] IndexedDB is unavailable');
    }

    const transaction = database.transaction(
        [CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME, CHECKPOINT_OWNER_CATALOG_STORE_NAME],
        'readonly'
    );
    const completion = checkpointOwnerSnapshot.transaction(transaction);
    const artifactRequest = transaction
        .objectStore(CHECKPOINT_ARTIFACT_STORE_NAME)
        .get(normalizedCheckpointId) as IDBRequest<unknown>;
    const catalogRequest = transaction
        .objectStore(CHECKPOINT_CATALOG_STORE_NAME)
        .get(normalizedCheckpointId) as IDBRequest<unknown>;
    const ownerSnapshot = checkpointOwnerSnapshot.read(transaction, normalizedOwnerProjectId);
    try {
        const [artifactValue, catalogValue, { snapshot }] = await Promise.all([
            checkpointOwnerSnapshot.request(artifactRequest),
            checkpointOwnerSnapshot.request(catalogRequest),
            ownerSnapshot,
        ]);
        await completion;

        if (artifactValue === undefined && catalogValue === undefined) {
            return null;
        }
        const artifactOwner = readStoredOwnerProjectId(artifactValue, 'artifact');
        const catalogOwner = readStoredOwnerProjectId(catalogValue, 'catalog');
        if (artifactOwner !== normalizedOwnerProjectId && catalogOwner !== normalizedOwnerProjectId) {
            return null;
        }
        if (!snapshot) {
            throw new Error('[CheckpointPersistence] Owned checkpoint pair has no owner catalog state');
        }
        return combineCheckpointPair(artifactValue, catalogValue, normalizedCheckpointId);
    } catch (error) {
        await completion.catch(() => undefined);
        throw error;
    }
}
