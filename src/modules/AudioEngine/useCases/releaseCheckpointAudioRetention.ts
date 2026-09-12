import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';

import { createCheckpointAudioRetentionRepository } from '../repositories/checkpointAudioRetention';
import { openAudioBufferCacheDatabase } from '../stores/audioBufferCache';

type ReleaseCheckpointAudioRetentionInput = {
    checkpointId: string;
    projectOwnerId: string;
    ownershipToken: string;
};

export function releaseCheckpointAudioRetention(input: ReleaseCheckpointAudioRetentionInput): Promise<boolean> {
    return withProjectAudioStorageLock(() =>
        createCheckpointAudioRetentionRepository({ openDatabase: openAudioBufferCacheDatabase }).release(input)
    );
}
