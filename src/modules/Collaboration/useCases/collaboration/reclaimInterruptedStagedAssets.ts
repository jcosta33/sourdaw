import {
    createDurableAssetRepository,
    type ReclaimInterruptedStagedAssetsResult,
} from '../../repositories/durableAssetRepository';

const RECOVERY_REPOSITORY_ID = 'collaboration:interrupted-staging-recovery';

/** Reclaim staging sets whose persisted AI operation owners were interrupted by restart. */
export function reclaimInterruptedStagedAssets(
    cleanupOwnerIds: readonly string[]
): Promise<ReclaimInterruptedStagedAssetsResult> {
    return createDurableAssetRepository(RECOVERY_REPOSITORY_ID).reclaimInterruptedStagedAssets(cleanupOwnerIds);
}
