import {
    type DeletedCheckpointArtifactOwnership,
    combineCheckpointPair,
    requireCheckpointIdentity,
} from './checkpointArtifactModel';
import { CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME, openDatabase } from './helpers';

export async function deleteCheckpointArtifact(
    checkpointId: string,
    ownerProjectId: string
): Promise<DeletedCheckpointArtifactOwnership | null> {
    const normalizedCheckpointId = requireCheckpointIdentity(checkpointId, 'checkpointId');
    const normalizedOwnerProjectId = requireCheckpointIdentity(ownerProjectId, 'ownerProjectId');
    const database = await openDatabase();
    if (!database) {
        throw new Error('[CheckpointPersistence] IndexedDB is unavailable');
    }

    return new Promise<DeletedCheckpointArtifactOwnership | null>((resolve, reject) => {
        const transaction = database.transaction(
            [CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME],
            'readwrite'
        );
        const artifactStore = transaction.objectStore(CHECKPOINT_ARTIFACT_STORE_NAME);
        const catalogStore = transaction.objectStore(CHECKPOINT_CATALOG_STORE_NAME);
        const artifactRequest = artifactStore.get(normalizedCheckpointId);
        const catalogRequest = catalogStore.get(normalizedCheckpointId);
        let completedReads = 0;
        let operationError: unknown;
        let result: DeletedCheckpointArtifactOwnership | null = null;

        const removeMatchingPair = (): void => {
            completedReads++;
            if (completedReads !== 2) {
                return;
            }
            try {
                const pair = combineCheckpointPair(
                    artifactRequest.result,
                    catalogRequest.result,
                    normalizedCheckpointId
                );
                if (!pair || pair.ownerProjectId !== normalizedOwnerProjectId) {
                    return;
                }
                result = {
                    checkpointId: pair.checkpointId,
                    projectOwnerId: pair.ownerProjectId,
                    ownershipToken: pair.ownershipToken,
                };
                artifactStore.delete(normalizedCheckpointId);
                catalogStore.delete(normalizedCheckpointId);
            } catch (error) {
                operationError = error;
                transaction.abort();
            }
        };
        artifactRequest.onsuccess = removeMatchingPair;
        catalogRequest.onsuccess = removeMatchingPair;

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(operationError ?? transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(operationError ?? transaction.error ?? new Error('IDB transaction aborted'));
    });
}
