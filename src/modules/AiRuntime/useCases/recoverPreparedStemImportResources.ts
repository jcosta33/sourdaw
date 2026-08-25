import { readAgentRunState } from '../stores/agentRunStore';

import { agentRunLifecycle } from './agentRunLifecycle';
import { reconcilePreparedStemImportRecovery } from './reconcilePreparedStemImportRecovery';

export async function recoverPreparedStemImportResources(input?: { runId?: string }): Promise<void> {
    const state = readAgentRunState();
    const runs = state.runs.filter((run) => input?.runId === undefined || run.runId === input.runId);
    const recoveries = (state.preparedStemImportRecoveryLedger ?? []).filter(
        (recovery) => input?.runId === undefined || recovery.runId === input.runId
    );
    for (const run of runs) {
        const recordedAssetIds = new Set(
            recoveries
                .filter((recovery) => recovery.runId === run.runId)
                .flatMap((recovery) => recovery.resources.map((resource) => resource.audioBufferId))
        );
        const legacyAssetIds = run.temporaryAssets
            .filter(
                (asset) =>
                    asset.cleanupOwner === 'stem-import-preparation' &&
                    asset.status !== 'released' &&
                    !recordedAssetIds.has(asset.assetId)
            )
            .map((asset) => asset.assetId);
        if (legacyAssetIds.length > 0) {
            agentRunLifecycle.requirePreparedStemManualRepair({
                runId: run.runId,
                assetIds: legacyAssetIds,
                batchIds: [],
            });
        }
    }
    for (const recovery of recoveries) {
        const result = await reconcilePreparedStemImportRecovery({
            runId: recovery.runId,
            batchId: recovery.batchId,
        });
        if (result.status === 'manual-repair') {
            agentRunLifecycle.requirePreparedStemManualRepair({
                runId: recovery.runId,
                assetIds: recovery.resources.map((resource) => resource.audioBufferId),
                batchIds: [recovery.batchId],
            });
        }
    }
}
