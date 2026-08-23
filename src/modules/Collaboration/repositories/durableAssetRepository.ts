import { createDurableAssetOwnerHandoffLifecycle } from './durableAssetOwnerHandoffLifecycle';
import { createDurableAssetOwnershipLifecycle } from './durableAssetOwnershipLifecycle';
import { createDurableAssetPromotionRecoveryLifecycle } from './durableAssetPromotionRecoveryLifecycle';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';
import { type DurableAssetRepository } from './durableAssetRepositoryContract';
import { createDurableAssetStageLifecycle } from './durableAssetStageLifecycle';

export { DEFAULT_STAGE_RECOVERY_PREFIX } from './durableAssetIndexedDb';

export type {
    AbortDurableAssetOwnerHandoffResult,
    DurableAsset,
    DurableAssetCommitProof,
    DurableAssetFailure,
    DurableAssetRepository,
    CancelDurableAssetPromotionRecoveryResult,
    CommitDurableAssetPromotionRecoveryResult,
    CompleteDurableAssetPromotionRecoveryResult,
    CompleteDurableAssetCleanupRecoveryResult,
    PromoteStagedAssetResult,
    PrepareDurableAssetOwnerHandoffResult,
    PrepareDurableAssetPromotionRecoveryResult,
    RebindDurableAssetOwnerResult,
    ReleaseDurableAssetOwnerResult,
    ReleaseOwnedAssetResult,
    ReleaseStagedAssetResult,
    ReleaseStagedAssetsResult,
    ReopenDurableAssetResult,
    ReopenStagedAssetResult,
    ResumeDurableAssetOwnerHandoffsResult,
    ResumeDurableAssetRecoveriesResult,
    StagedAssetBinding,
} from './durableAssetRepositoryContract';

const records = createDurableAssetRecordAccess();

/** Own content-addressed originals for one opaque Collaboration project identity. */
export function createDurableAssetRepository(ownerId: string): DurableAssetRepository {
    if (ownerId.length === 0) {
        throw new Error('Collaboration asset owner identity is required');
    }
    const stage = createDurableAssetStageLifecycle(ownerId);
    const ownership = createDurableAssetOwnershipLifecycle(ownerId);
    return {
        ...stage,
        ...ownership,
        ...createDurableAssetOwnerHandoffLifecycle(ownerId),
        ...createDurableAssetPromotionRecoveryLifecycle(
            ownerId,
            stage.promoteStagedAsset,
            stage.reopenDurableAsset,
            ownership.releaseStagedAssets
        ),
        subscribeInvalidation: records.subscribeInvalidation,
    };
}
