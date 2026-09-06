import {
    type CheckpointArtifactRecord,
    combineCheckpointPair,
    requireCheckpointIdentity,
} from './checkpointArtifactModel';
import { CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME, openDatabase } from './helpers';

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

    return new Promise<CheckpointArtifactRecord | null>((resolve, reject) => {
        const transaction = database.transaction(
            [CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME],
            'readonly'
        );
        const artifactRequest = transaction.objectStore(CHECKPOINT_ARTIFACT_STORE_NAME).get(normalizedCheckpointId);
        const catalogRequest = transaction.objectStore(CHECKPOINT_CATALOG_STORE_NAME).get(normalizedCheckpointId);

        transaction.oncomplete = () => {
            try {
                const result = combineCheckpointPair(
                    artifactRequest.result,
                    catalogRequest.result,
                    normalizedCheckpointId
                );
                resolve(result?.ownerProjectId === normalizedOwnerProjectId ? result : null);
            } catch (error) {
                reject(error);
            }
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
    });
}
