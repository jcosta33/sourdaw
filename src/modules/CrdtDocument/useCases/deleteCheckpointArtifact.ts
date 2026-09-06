import { deleteCheckpointArtifact as deleteCheckpointArtifactPersistence } from '../repositories/crdtPersistence/deleteCheckpointArtifact';

export function deleteCheckpointArtifact(
    checkpointId: Parameters<typeof deleteCheckpointArtifactPersistence>[0],
    ownerProjectId: Parameters<typeof deleteCheckpointArtifactPersistence>[1]
): ReturnType<typeof deleteCheckpointArtifactPersistence> {
    return deleteCheckpointArtifactPersistence(checkpointId, ownerProjectId);
}
