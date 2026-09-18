import { createCheckpointAudioRetentionRepository } from '../repositories/checkpointAudioRetention';
import { openAudioBufferCacheDatabase } from '../stores/audioBufferCache';

type ReadCheckpointAudioRetentionInput = {
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
    expectedBufferIds: readonly string[];
    audioContext: Pick<BaseAudioContext, 'createBuffer'>;
};

type ReadCheckpointAudioRetentionResult =
    { status: 'read'; decodedAudioBuffers: Record<string, AudioBuffer> } | { status: 'refused' };

export function readCheckpointAudioRetention(
    input: ReadCheckpointAudioRetentionInput
): Promise<ReadCheckpointAudioRetentionResult> {
    return createCheckpointAudioRetentionRepository({ openDatabase: openAudioBufferCacheDatabase }).read(input);
}
