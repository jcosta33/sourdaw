import { type StemImportPromptScope } from '../../models/StemImportCapability';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

const CLEANUP_OWNER = 'stem-import-preparation';

export function registerPreparedStemImportResources(input: {
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
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
            cleanup: () => discardPreparedStemImportResources([stem]),
        });
    }
}
