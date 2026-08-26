import { type AgentRunPreparedStemImportRecovery } from '../models/AgentRun';

export function hasSamePreparedStemImportRecovery(
    left: AgentRunPreparedStemImportRecovery,
    right: AgentRunPreparedStemImportRecovery
): boolean {
    return (
        left.schemaVersion === right.schemaVersion &&
        left.batchId === right.batchId &&
        left.serializedCommandBatch === right.serializedCommandBatch &&
        left.resources.length === right.resources.length &&
        left.resources.every((resource, index) => {
            const other = right.resources[index];
            return (
                other !== undefined &&
                resource.audioBufferId === other.audioBufferId &&
                resource.assetLeaseId === other.assetLeaseId
            );
        })
    );
}
