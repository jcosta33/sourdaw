import { commitCheckpointArtifact as commitCheckpointArtifactPersistence } from '../repositories/crdtPersistence/commitCheckpointArtifact';

export function commitCheckpointArtifact(
    input: Parameters<typeof commitCheckpointArtifactPersistence>[0]
): ReturnType<typeof commitCheckpointArtifactPersistence> {
    return commitCheckpointArtifactPersistence(input);
}
