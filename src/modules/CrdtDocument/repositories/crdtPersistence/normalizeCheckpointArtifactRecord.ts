import { type CheckpointArtifactRecord } from '../../models/CheckpointArtifact';

import { parseCheckpointArtifactEntry } from './parseCheckpointArtifactEntry';
import { parseCheckpointCatalogEntry } from './parseCheckpointCatalogEntry';

export function normalizeCheckpointArtifactRecord(value: unknown): CheckpointArtifactRecord {
    const catalog = parseCheckpointCatalogEntry(value);
    const artifact = parseCheckpointArtifactEntry(value);
    return { ...catalog, rootBytes: artifact.rootBytes };
}
