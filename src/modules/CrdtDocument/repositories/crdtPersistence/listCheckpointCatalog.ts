import {
    type CheckpointCatalogEntry,
    combineCheckpointPair,
    parseCheckpointArtifactEntry,
    requireCheckpointIdentity,
} from './checkpointArtifactModel';
import { CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME, openDatabase } from './helpers';

function compareCatalogEntries(left: CheckpointCatalogEntry, right: CheckpointCatalogEntry): number {
    const createdAtOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (createdAtOrder !== 0) {
        return createdAtOrder;
    }
    if (left.checkpointId < right.checkpointId) {
        return -1;
    }
    if (left.checkpointId > right.checkpointId) {
        return 1;
    }
    return 0;
}

export async function listCheckpointCatalog(ownerProjectId: string): Promise<CheckpointCatalogEntry[]> {
    const normalizedOwnerProjectId = requireCheckpointIdentity(ownerProjectId, 'ownerProjectId');
    const database = await openDatabase();
    if (!database) {
        throw new Error('[CheckpointPersistence] IndexedDB is unavailable');
    }

    return new Promise<CheckpointCatalogEntry[]>((resolve, reject) => {
        const transaction = database.transaction(
            [CHECKPOINT_ARTIFACT_STORE_NAME, CHECKPOINT_CATALOG_STORE_NAME],
            'readonly'
        );
        const artifactStore = transaction.objectStore(CHECKPOINT_ARTIFACT_STORE_NAME);
        const catalogStore = transaction.objectStore(CHECKPOINT_CATALOG_STORE_NAME);
        const artifactKeysRequest = artifactStore.getAllKeys();
        const artifactsRequest = artifactStore.getAll();
        const catalogKeysRequest = catalogStore.getAllKeys();
        const catalogRequest = catalogStore.getAll();

        transaction.oncomplete = () => {
            try {
                if (artifactKeysRequest.result.length !== artifactsRequest.result.length) {
                    throw new Error('[CheckpointPersistence] Artifact key/value result mismatch');
                }
                if (catalogKeysRequest.result.length !== catalogRequest.result.length) {
                    throw new Error('[CheckpointPersistence] Catalog key/value result mismatch');
                }

                const artifactsById = new Map<string, unknown>();
                artifactKeysRequest.result.forEach((key, index) => {
                    const checkpointId = requireCheckpointIdentity(key, 'artifact checkpoint key');
                    artifactsById.set(checkpointId, artifactsRequest.result[index]);
                });
                const catalogIds = new Set<string>();
                const catalog = catalogKeysRequest.result.flatMap((key, index) => {
                    const checkpointId = requireCheckpointIdentity(key, 'catalog checkpoint key');
                    catalogIds.add(checkpointId);
                    const pair = combineCheckpointPair(
                        artifactsById.get(checkpointId),
                        catalogRequest.result[index],
                        checkpointId
                    );
                    if (!pair) {
                        throw new Error('[CheckpointPersistence] Stored checkpoint pair is incomplete');
                    }
                    if (pair.ownerProjectId !== normalizedOwnerProjectId) {
                        return [];
                    }
                    const { rootBytes: _rootBytes, ...entry } = pair;
                    return [entry];
                });
                for (const [checkpointId, artifactValue] of artifactsById) {
                    if (catalogIds.has(checkpointId)) {
                        continue;
                    }
                    const artifact = parseCheckpointArtifactEntry(artifactValue);
                    if (artifact.checkpointId !== checkpointId) {
                        throw new Error('[CheckpointPersistence] Stored checkpoint artifact key mismatch');
                    }
                    if (artifact.ownerProjectId === normalizedOwnerProjectId) {
                        throw new Error('[CheckpointPersistence] Stored checkpoint pair is incomplete');
                    }
                }
                catalog.sort(compareCatalogEntries);
                resolve(catalog);
            } catch (error) {
                reject(error);
            }
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
    });
}
