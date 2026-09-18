import { commitCheckpointCatalog as commitCheckpointCatalogPersistence } from '../repositories/crdtPersistence/commitCheckpointCatalog';

export function commitCheckpointCatalog(
    input: Parameters<typeof commitCheckpointCatalogPersistence>[0],
    options: Parameters<typeof commitCheckpointCatalogPersistence>[1]
): ReturnType<typeof commitCheckpointCatalogPersistence> {
    return commitCheckpointCatalogPersistence(input, options);
}
