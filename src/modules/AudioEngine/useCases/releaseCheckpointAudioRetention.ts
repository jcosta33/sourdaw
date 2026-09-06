import { audioBufferCache } from '../stores/audioBufferCache';

type ReleaseCheckpointAudioRetentionInput = {
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
};

export function releaseCheckpointAudioRetention({
    checkpointId,
    projectOwnerId,
    ownershipToken,
}: ReleaseCheckpointAudioRetentionInput): Promise<boolean> {
    return audioBufferCache.releaseCheckpointRetention({ checkpointId, projectOwnerId, ownershipToken });
}
