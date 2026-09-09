import {
    CHECKPOINT_ARTIFACT_STORE_NAME,
    CHECKPOINT_CATALOG_STORE_NAME,
    CHECKPOINT_OWNER_CATALOG_STORE_NAME,
    openDatabase,
} from './helpers';
import { checkpointOwnerSnapshot } from './readCheckpointOwnerSnapshot';
import { requireCheckpointIdentity } from './requireCheckpointIdentity';

export async function readCheckpointCatalog(ownerProjectId: string) {
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
    try {
        const { snapshot } = await checkpointOwnerSnapshot.read(transaction, normalizedOwnerProjectId);
        await completion;
        return snapshot;
    } catch (error) {
        await completion.catch(() => undefined);
        throw error;
    }
}
