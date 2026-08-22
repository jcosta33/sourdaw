import {
    getVersionedCommandBatchIdempotentReplay,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';

import { preparedStemImportResources } from './agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from './agentRunLifecycle';

export function reconcilePreparedStemImportRecovery(input: { runId: string; batchId: string }) {
    const recovery = agentRunLifecycle
        .get(input.runId)
        ?.preparedStemImports.find((candidate) => candidate.batchId === input.batchId);
    if (!recovery) {
        return Promise.resolve({ status: 'missing' as const });
    }
    const parsed = parseVersionedCommandBatchEnvelope(recovery.serializedCommandBatch);
    if (
        parsed.status === 'invalid' ||
        parsed.envelope.runId !== input.runId ||
        parsed.envelope.batchId !== input.batchId
    ) {
        return Promise.resolve({ status: 'manual-repair' as const });
    }
    const commandBatch = {
        serialized: recovery.serializedCommandBatch,
        authority: {
            projectId: parsed.envelope.projectId,
            baseRevision: parsed.envelope.baseRevision,
            scope: parsed.envelope.scope,
            grants: parsed.envelope.grants,
            budgets: parsed.envelope.budgets,
        },
    };
    try {
        if (preparedStemImportResources.hydrate({ runId: input.runId, recovery, commandBatch })) {
            return preparedStemImportResources.reconcile({
                ...input,
                getVerifiedReceipt: getVersionedCommandBatchIdempotentReplay,
            });
        }
    } catch {
        // The persisted owner stays cleanup-pending when its runtime cleanup
        // registration cannot be reconstructed safely.
    }
    return Promise.resolve({ status: 'manual-repair' as const });
}
