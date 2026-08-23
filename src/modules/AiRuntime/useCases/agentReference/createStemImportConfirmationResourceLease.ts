import { getAssetTransfer } from '#/modules/Collaboration/useCases';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { preparedStemImportCleanup } from './discardPreparedStemImportResources';

export function createStemImportConfirmationResourceLease(
    actions: readonly ExecutableRuntimeAction[],
    recoveryId?: string
) {
    const stems = actions.flatMap((action) => (action.type === 'importStemSet' ? action.payload.stems : []));
    if (stems.length === 0) {
        return undefined;
    }

    let released = false;
    let releaseInFlight: Promise<void> | null = null;
    const bindings = stems.map((stem) => {
        if (!stem.assetLeaseId || !stem.assetHash) {
            throw new Error('Prepared stem durable asset binding is incomplete');
        }
        return { leaseId: stem.assetLeaseId, expectedHash: stem.assetHash };
    });
    return {
        bytes: stems.reduce((total, stem) => total + stem.sourceBytes + stem.decodedBytes, 0),
        prepareForCommit: recoveryId
            ? async () => {
                  const transfer = getAssetTransfer();
                  if (!transfer) {
                      throw new Error('Asset transfer is unavailable for committed stem promotion recovery');
                  }
                  const prepared = await transfer.prepareDurablePromotionRecovery(recoveryId, bindings);
                  if (prepared.status === 'failed') {
                      throw new Error(`Could not prepare committed stem promotion recovery: ${prepared.reason}`);
                  }
              }
            : undefined,
        release: async () => {
            if (released) {
                return;
            }
            releaseInFlight ??= (async () => {
                if (recoveryId) {
                    const transfer = getAssetTransfer();
                    if (!transfer) {
                        throw new Error('Asset transfer is unavailable for stem promotion recovery cancellation');
                    }
                    const cancelled = await transfer.cancelDurablePromotionRecovery(recoveryId);
                    if (cancelled.status === 'failed') {
                        throw new Error(`Could not cancel committed stem promotion recovery: ${cancelled.reason}`);
                    }
                }
                await preparedStemImportCleanup.discard(stems);
                released = true;
            })().finally(() => {
                releaseInFlight = null;
            });
            await releaseInFlight;
        },
        releaseBestEffort: () => preparedStemImportCleanup.discardBestEffort(stems),
        retain: recoveryId
            ? async () => {
                  const transfer = getAssetTransfer();
                  if (!transfer) {
                      throw new Error('Asset transfer is unavailable for committed stem promotion recovery');
                  }
                  const completed = await transfer.completeDurablePromotionRecovery(recoveryId);
                  if (completed.status === 'failed') {
                      throw new Error(`Committed stem promotion remains pending: ${completed.reason}`);
                  }
                  if (completed.status === 'missing') {
                      for (const binding of bindings) {
                          const reopened = await transfer.reopenDurableAsset(binding.expectedHash);
                          if (reopened.status === 'failed') {
                              throw new Error(`Committed stem promotion proof is unavailable: ${reopened.reason}`);
                          }
                      }
                  }
              }
            : undefined,
    };
}
