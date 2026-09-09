import { readCheckpointCatalog as readCheckpointCatalogPersistence } from '../repositories/crdtPersistence/readCheckpointCatalog';

export function readCheckpointCatalog(
    ownerProjectId: Parameters<typeof readCheckpointCatalogPersistence>[0]
): ReturnType<typeof readCheckpointCatalogPersistence> {
    return readCheckpointCatalogPersistence(ownerProjectId);
}
