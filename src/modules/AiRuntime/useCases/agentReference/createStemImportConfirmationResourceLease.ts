import { logger } from '#/infra/logger/appLogger';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { getVersionedCommandBatchCommitProof } from '#/modules/Command/useCases';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { preparedStemImportCleanup } from './discardPreparedStemImportResources';
import { preparedStemImportResources } from './registerPreparedStemImportResources';

type PreparedStemRecovery = Parameters<typeof preparedStemImportResources.protect>[0]['recovery'];

type StemImportConfirmationResourceLeaseInput =
    | {
          actions: readonly ExecutableRuntimeAction[];
          kind: 'registered';
          recovery: PreparedStemRecovery | undefined;
          runId: string;
      }
    | {
          actions: readonly ExecutableRuntimeAction[];
          kind: 'durable-promotion';
          recoveryId: string | undefined;
          runId: string | undefined;
      }
    | null;

function resolveStemImportConfirmationResourceLeaseInput(
    first: string | readonly ExecutableRuntimeAction[],
    second?: string | readonly ExecutableRuntimeAction[],
    third?: string | PreparedStemRecovery
): StemImportConfirmationResourceLeaseInput {
    if (typeof first === 'string') {
        if (!Array.isArray(second)) {
            return null;
        }
        const recovery = typeof third === 'object' ? third : undefined;
        return {
            actions: second,
            kind: 'registered',
            recovery,
            runId: first,
        };
    }
    return {
        actions: first,
        kind: 'durable-promotion',
        recoveryId: typeof second === 'string' ? second : undefined,
        runId: typeof third === 'string' ? third : undefined,
    };
}

function reportPreparedStemImportResourceReleaseFailure(error: unknown): void {
    logger.error(
        new Error('Prepared stem import resource cleanup failed after confirmation release', {
            cause: error,
        })
    );
}

function getDurablePromotionBindings(stems: readonly { assetHash?: string; assetLeaseId?: string }[]) {
    return stems.map((stem) => {
        if (!stem.assetLeaseId || !stem.assetHash) {
            throw new Error('Prepared stem durable asset binding is incomplete');
        }
        return { leaseId: stem.assetLeaseId, expectedHash: stem.assetHash };
    });
}

export function createStemImportConfirmationResourceLease(
    first: string | readonly ExecutableRuntimeAction[],
    second?: string | readonly ExecutableRuntimeAction[],
    third?: string | PreparedStemRecovery
) {
    const input = resolveStemImportConfirmationResourceLeaseInput(first, second, third);
    if (!input) {
        return undefined;
    }
    const { actions } = input;
    const stems = actions.flatMap((action) => (action.type === 'importStemSet' ? action.payload.stems : []));
    if (stems.length === 0) {
        return undefined;
    }

    if (input.kind === 'registered') {
        const { recovery, runId } = input;
        return {
            bytes: stems.reduce((total, stem) => total + stem.sourceBytes + stem.decodedBytes, 0),
            protect: () => preparedStemImportResources.protect({ runId, stems, recovery }),
            retain: () => preparedStemImportResources.retainForRecovery({ runId, stems, recovery }),
            transfer: () => preparedStemImportResources.release({ runId, stems }),
            release: () => {
                void preparedStemImportResources
                    .discard({ runId, stems })
                    .catch(reportPreparedStemImportResourceReleaseFailure);
            },
        };
    }

    const { recoveryId, runId } = input;
    let released = false;
    let releaseInFlight: Promise<void> | null = null;
    const bindings = recoveryId ? getDurablePromotionBindings(stems) : [];
    if (runId) {
        preparedStemImportResources.release({ runId, stems });
    }
    return {
        bytes: stems.reduce((total, stem) => total + stem.sourceBytes + stem.decodedBytes, 0),
        prepareForCommit: recoveryId
            ? async (commandBatch?: Parameters<typeof getVersionedCommandBatchCommitProof>[0]) => {
                  if (!commandBatch) {
                      throw new Error('Command batch commit proof input is unavailable for stem promotion recovery');
                  }
                  const transfer = getAssetTransfer();
                  if (!transfer) {
                      throw new Error('Asset transfer is unavailable for committed stem promotion recovery');
                  }
                  const commitProof = await getVersionedCommandBatchCommitProof(commandBatch);
                  const prepared = await transfer.prepareDurablePromotionRecovery(recoveryId, bindings, commitProof);
                  if (prepared.status === 'failed') {
                      throw new Error(`Could not prepare committed stem promotion recovery: ${prepared.reason}`);
                  }
              }
            : undefined,
        commit: recoveryId
            ? async () => {
                  const transfer = getAssetTransfer();
                  if (!transfer) {
                      throw new Error('Asset transfer is unavailable for committed stem promotion recovery');
                  }
                  const committed = await transfer.commitDurablePromotionRecovery(recoveryId);
                  if (committed.status === 'failed') {
                      throw new Error(`Could not commit stem promotion recovery: ${committed.reason}`);
                  }
              }
            : undefined,
        release: async () => {
            if (released) {
                return;
            }
            releaseInFlight ??= (async () => {
                await preparedStemImportCleanup.discard(stems, recoveryId);
                released = true;
            })().finally(() => {
                releaseInFlight = null;
            });
            await releaseInFlight;
        },
        releaseBestEffort: () => preparedStemImportCleanup.discardBestEffort(stems, recoveryId),
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
