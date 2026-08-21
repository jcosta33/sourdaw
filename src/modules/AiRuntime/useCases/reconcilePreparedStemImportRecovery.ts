import { getVersionedCommandBatchIdempotentReplay } from '#/modules/Command/useCases';

import { preparedStemImportResources } from './agentReference/registerPreparedStemImportResources';

export function reconcilePreparedStemImportRecovery(input: { runId: string; batchId: string }) {
    return preparedStemImportResources.reconcile({
        ...input,
        getVerifiedReceipt: getVersionedCommandBatchIdempotentReplay,
    });
}
