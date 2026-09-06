import { readCheckpointArtifact as readCheckpointArtifactPersistence } from '../repositories/crdtPersistence/readCheckpointArtifact';

export function readCheckpointArtifact(
    checkpointId: Parameters<typeof readCheckpointArtifactPersistence>[0],
    ownerProjectId: Parameters<typeof readCheckpointArtifactPersistence>[1]
): ReturnType<typeof readCheckpointArtifactPersistence> {
    return readCheckpointArtifactPersistence(checkpointId, ownerProjectId);
}
