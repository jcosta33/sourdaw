import {
    type CheckpointCatalogSnapshot,
    type CheckpointOwnerState,
    checkpointOwnerCatalogState,
} from './checkpointOwnerCatalogState';
import {
    CHECKPOINT_ARTIFACT_STORE_NAME,
    CHECKPOINT_CATALOG_STORE_NAME,
    CHECKPOINT_OWNER_CATALOG_STORE_NAME,
    CHECKPOINT_OWNER_PROJECT_INDEX_NAME,
} from './helpers';

export type CheckpointOwnerSnapshot = {
    snapshot: CheckpointCatalogSnapshot | null;
    state: CheckpointOwnerState | null;
};

function requestResult<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
    });
}

async function readCheckpointOwnerSnapshot(
    transaction: IDBTransaction,
    ownerProjectId: string
): Promise<CheckpointOwnerSnapshot> {
    const artifactIndex = transaction
        .objectStore(CHECKPOINT_ARTIFACT_STORE_NAME)
        .index(CHECKPOINT_OWNER_PROJECT_INDEX_NAME);
    const catalogIndex = transaction
        .objectStore(CHECKPOINT_CATALOG_STORE_NAME)
        .index(CHECKPOINT_OWNER_PROJECT_INDEX_NAME);
    const stateRequest = transaction
        .objectStore(CHECKPOINT_OWNER_CATALOG_STORE_NAME)
        .get(ownerProjectId) as IDBRequest<unknown>;
    const catalogValuesRequest = catalogIndex.getAll(ownerProjectId) as IDBRequest<unknown[]>;
    const catalogKeysRequest = catalogIndex.getAllKeys(ownerProjectId);
    const artifactKeysRequest = artifactIndex.getAllKeys(ownerProjectId);

    const [storedState, catalogValues, catalogKeys, artifactKeys] = await Promise.all([
        requestResult(stateRequest),
        requestResult(catalogValuesRequest),
        requestResult(catalogKeysRequest),
        requestResult(artifactKeysRequest),
    ]);
    const checkpoints = checkpointOwnerCatalogState.parseCheckpointMetadata(catalogValues, catalogKeys, ownerProjectId);
    const artifactIds = checkpointOwnerCatalogState.parseArtifactKeys(artifactKeys);
    checkpointOwnerCatalogState.validatePairs(checkpoints, artifactIds);
    if (storedState === undefined) {
        if (checkpoints.length > 0) {
            throw new Error('[CheckpointPersistence] Checkpoint pairs exist without owner catalog state');
        }
        return { snapshot: null, state: null };
    }

    const state = checkpointOwnerCatalogState.parseStored(storedState, ownerProjectId);
    checkpointOwnerCatalogState.validateGraph(state, checkpoints);
    return { snapshot: checkpointOwnerCatalogState.detachedSnapshot(state, checkpoints), state };
}

export const checkpointOwnerSnapshot = {
    read: readCheckpointOwnerSnapshot,
    request: requestResult,
    transaction: transactionCompletion,
};
