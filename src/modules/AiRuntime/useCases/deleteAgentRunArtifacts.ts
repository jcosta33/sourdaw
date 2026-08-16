import { readAgentRunState, persistAgentRunState } from '../stores/agentRunStore';

import { agentRunCancellation } from './cancelAgentRun';

export type DeleteAgentRunArtifactsResult =
    | { status: 'missing'; deletedAssetIds: []; failedAssetIds: [] }
    | { status: 'completed' | 'partial'; deletedAssetIds: string[]; failedAssetIds: string[] };

export async function deleteAgentRunArtifacts(runId: string): Promise<DeleteAgentRunArtifactsResult> {
    const state = readAgentRunState();
    const run = state.runs.find((candidate) => candidate.runId === runId);
    if (!run) {
        return { status: 'missing', deletedAssetIds: [], failedAssetIds: [] };
    }
    const deletedAssetIds: string[] = [];
    const failedAssetIds: string[] = [];
    for (const asset of run.temporaryAssets) {
        if (asset.status === 'released') {
            deletedAssetIds.push(asset.assetId);
            continue;
        }
        const outcome = await agentRunCancellation.cleanupTemporaryAsset({
            runId,
            assetId: asset.assetId,
            cleanupOwner: asset.cleanupOwner,
        });
        if (outcome.status === 'deleted') {
            deletedAssetIds.push(asset.assetId);
        } else {
            failedAssetIds.push(asset.assetId);
        }
    }
    const completed = new Set(deletedAssetIds);
    const current = readAgentRunState();
    persistAgentRunState({
        ...current,
        runs: current.runs.map((candidate) =>
            candidate.runId === runId
                ? {
                      ...candidate,
                      temporaryAssets: candidate.temporaryAssets.filter((asset) => !completed.has(asset.assetId)),
                  }
                : candidate
        ),
    });
    return {
        status: failedAssetIds.length === 0 ? 'completed' : 'partial',
        deletedAssetIds,
        failedAssetIds,
    };
}
