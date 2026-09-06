import { type CheckpointArtifactRecord } from '../../models/CheckpointArtifact';

import { parseCheckpointArtifactEntry } from './parseCheckpointArtifactEntry';
import { parseCheckpointCatalogEntry } from './parseCheckpointCatalogEntry';

export function combineCheckpointPair(
    artifactValue: unknown,
    catalogValue: unknown,
    expectedCheckpointId: string
): CheckpointArtifactRecord | null {
    const artifactMissing = artifactValue === undefined;
    const catalogMissing = catalogValue === undefined;
    if (artifactMissing && catalogMissing) {
        return null;
    }
    if (artifactMissing || catalogMissing) {
        throw new Error('[CheckpointPersistence] Stored checkpoint pair is incomplete');
    }

    const artifact = parseCheckpointArtifactEntry(artifactValue);
    const catalog = parseCheckpointCatalogEntry(catalogValue);
    if (
        artifact.checkpointId !== expectedCheckpointId ||
        catalog.checkpointId !== expectedCheckpointId ||
        artifact.ownerProjectId !== catalog.ownerProjectId
    ) {
        throw new Error('[CheckpointPersistence] Stored checkpoint pair identity mismatch');
    }

    return { ...catalog, rootBytes: artifact.rootBytes };
}
