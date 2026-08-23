import { createDurableAssetOwnerHandoffLifecycle } from './durableAssetOwnerHandoffLifecycle';
import { createDurableAssetOwnershipLifecycle } from './durableAssetOwnershipLifecycle';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';
import { type DurableAssetRepository } from './durableAssetRepositoryContract';
import { createDurableAssetStageLifecycle } from './durableAssetStageLifecycle';

export type {
    DurableAsset,
    DurableAssetFailure,
    DurableAssetRepository,
    PromoteStagedAssetResult,
    PrepareDurableAssetOwnerHandoffResult,
    RebindDurableAssetOwnerResult,
    ReleaseDurableAssetOwnerResult,
    ReleaseOwnedAssetResult,
    ReleaseStagedAssetResult,
    ReleaseStagedAssetsResult,
    ReopenDurableAssetResult,
    ReopenStagedAssetResult,
    ResumeDurableAssetOwnerHandoffsResult,
    StagedAssetBinding,
} from './durableAssetRepositoryContract';

const records = createDurableAssetRecordAccess();

/** Own content-addressed originals for one opaque Collaboration project identity. */
export function createDurableAssetRepository(ownerId: string): DurableAssetRepository {
    if (ownerId.length === 0) {
        throw new Error('Collaboration asset owner identity is required');
    }
    return {
        ...createDurableAssetStageLifecycle(ownerId),
        ...createDurableAssetOwnershipLifecycle(ownerId),
        ...createDurableAssetOwnerHandoffLifecycle(ownerId),
        subscribeInvalidation: records.subscribeInvalidation,
    };
}
