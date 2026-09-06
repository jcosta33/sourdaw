import { listCheckpointCatalog as listCheckpointCatalogPersistence } from '../repositories/crdtPersistence/listCheckpointCatalog';

export function listCheckpointCatalog(
    ownerProjectId: Parameters<typeof listCheckpointCatalogPersistence>[0]
): ReturnType<typeof listCheckpointCatalogPersistence> {
    return listCheckpointCatalogPersistence(ownerProjectId);
}
