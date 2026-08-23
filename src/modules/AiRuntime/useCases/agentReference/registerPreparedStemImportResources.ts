import { type StemImportPromptScope } from '../../models/StemImportCapability';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';

import { preparedStemImportCleanup } from './discardPreparedStemImportResources';

const CLEANUP_OWNER = 'stem-import-preparation';
const registrations = new Map<string, () => void>();

function key(runId: string, assetId: string): string {
    return `${runId}\u0000${assetId}`;
}

function registerPreparedStemImportResources(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
}): void {
    for (const stem of input.stems) {
        agentRunLifecycle.registerTemporaryAsset({
            runId: input.runId,
            assetId: stem.audioBufferId,
            kind: 'import',
            cleanupOwner: CLEANUP_OWNER,
        });
        const unregister = agentRunCancellation.registerTemporaryAssetCleanup({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
            cleanup: () => preparedStemImportCleanup.discard([stem]),
        });
        registrations.set(key(input.runId, stem.audioBufferId), unregister);
    }
}

function releasePreparedStemImportResources(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
}): void {
    for (const stem of input.stems) {
        registrations.get(key(input.runId, stem.audioBufferId))?.();
        registrations.delete(key(input.runId, stem.audioBufferId));
        const registeredAsset = agentRunLifecycle
            .get(input.runId)
            ?.temporaryAssets.find((candidate) => candidate.assetId === stem.audioBufferId);
        if (!registeredAsset) {
            continue;
        }
        agentRunLifecycle.forgetTemporaryAsset({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
        });
    }
}

export const preparedStemImportResources = {
    register: registerPreparedStemImportResources,
    release: releasePreparedStemImportResources,
};
