import {
    runInProjectAudioStorageLock,
    type ProjectAudioStorageLockScope,
} from '#/infra/storage/withProjectAudioStorageLock';

import { createCheckpointAudioRetentionRepository } from '../repositories/checkpointAudioRetention';
import { authenticateCheckpointAudioRetentionReceipt, openAudioBufferCacheDatabase } from '../stores/audioBufferCache';

import type { CachedAudioBuffersDurabilityReceipt } from './ensureCachedAudioBuffersDurable';

type AcquireCheckpointAudioRetentionInput = {
    checkpointId: string;
    projectOwnerId: string;
    durabilityReceipt: CachedAudioBuffersDurabilityReceipt;
    scope: ProjectAudioStorageLockScope;
};

type CheckpointRetentionAcquisitionResult =
    | { status: 'retained'; ownershipToken: string }
    | { status: 'superseded' }
    | { status: 'cleanup-failed'; ownershipToken: string };

export function acquireCheckpointAudioRetention({
    checkpointId,
    projectOwnerId,
    durabilityReceipt,
    scope,
}: AcquireCheckpointAudioRetentionInput): Promise<CheckpointRetentionAcquisitionResult> {
    return runInProjectAudioStorageLock(scope, async () => {
        const authority = authenticateCheckpointAudioRetentionReceipt(durabilityReceipt);
        const repository = createCheckpointAudioRetentionRepository({ openDatabase: openAudioBufferCacheDatabase });
        const acquisition = await repository.acquire({ checkpointId, projectOwnerId, authority });
        if (acquisition.status === 'superseded' || authority.isCurrent()) {
            return acquisition;
        }
        try {
            const cleaned = await repository.release({
                checkpointId,
                projectOwnerId,
                ownershipToken: acquisition.ownershipToken,
            });
            return cleaned
                ? { status: 'superseded' }
                : { status: 'cleanup-failed', ownershipToken: acquisition.ownershipToken };
        } catch {
            return { status: 'cleanup-failed', ownershipToken: acquisition.ownershipToken };
        }
    });
}
