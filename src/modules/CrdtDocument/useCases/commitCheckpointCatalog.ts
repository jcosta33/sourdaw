import { commitCheckpointCatalog as commitCheckpointCatalogPersistence } from '../repositories/crdtPersistence/commitCheckpointCatalog';

export function commitCheckpointCatalog(
    input: Parameters<typeof commitCheckpointCatalogPersistence>[0]
): ReturnType<typeof commitCheckpointCatalogPersistence> {
    return commitCheckpointCatalogPersistence(input);
}
