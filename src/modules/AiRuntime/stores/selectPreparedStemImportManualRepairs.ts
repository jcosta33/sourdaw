import { type AgentRunState } from '../models/AgentRun';

export type PreparedStemImportManualRepairProjection = {
    runId: string;
    batchId: string;
    audioBufferIds: string[];
    reason: string;
};

/** Public read projection for retained prepared media that cannot be reconciled automatically. */
export function selectPreparedStemImportManualRepairs(
    state: AgentRunState | null | undefined
): PreparedStemImportManualRepairProjection[] {
    return (state?.preparedStemImportRecoveryLedger ?? [])
        .filter(
            (recovery): recovery is typeof recovery & { status: 'manual-repair'; lastError: string } =>
                recovery.status === 'manual-repair' && recovery.lastError !== null
        )
        .map((recovery) => ({
            runId: recovery.runId,
            batchId: recovery.batchId,
            audioBufferIds: recovery.resources.map((resource) => resource.audioBufferId),
            reason: recovery.lastError,
        }));
}
