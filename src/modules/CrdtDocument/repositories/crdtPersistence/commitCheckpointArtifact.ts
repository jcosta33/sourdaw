import { type CheckpointArtifactRecord, normalizeCheckpointArtifactRecord } from './checkpointArtifactModel';
import { CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME, openDatabase } from './helpers';

export async function commitCheckpointArtifact(input: CheckpointArtifactRecord): Promise<void> {
    const normalized = normalizeCheckpointArtifactRecord(input);
    const { rootBytes, ...catalog } = normalized;
    const artifact = {
        checkpointId: normalized.checkpointId,
        ownerProjectId: normalized.ownerProjectId,
        rootBytes,
    };
    const database = await openDatabase();
    if (!database) {
        throw new Error('[CheckpointPersistence] IndexedDB is unavailable');
    }

    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
            [CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME],
            'readwrite'
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));

        transaction.objectStore(CHECKPOINT_ARTIFACT_STORE_NAME).add(artifact, normalized.checkpointId);
        transaction.objectStore(CHECKPOINT_CATALOG_STORE_NAME).add(catalog, normalized.checkpointId);
    });
}
