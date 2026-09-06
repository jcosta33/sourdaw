import { audioBufferCache } from '../stores/audioBufferCache';

type AcquireCheckpointAudioRetentionInput = {
    checkpointId: string;
    projectOwnerId: string;
    bufferIds: readonly string[];
};

export function acquireCheckpointAudioRetention({
    checkpointId,
    projectOwnerId,
    bufferIds,
}: AcquireCheckpointAudioRetentionInput): Promise<{ ownershipToken: string }> {
    return audioBufferCache.acquireCheckpointRetention({ checkpointId, projectOwnerId, bufferIds });
}
