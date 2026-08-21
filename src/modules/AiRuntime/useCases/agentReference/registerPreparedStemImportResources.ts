import { type StemImportPromptScope } from '../../models/StemImportCapability';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

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
            cleanup: () => discardPreparedStemImportResources([stem]),
        });
        registrations.set(key(input.runId, stem.audioBufferId), unregister);
    }
}

function releasePreparedStemImportResources(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
}): void {
    for (const stem of input.stems) {
        const registrationKey = key(input.runId, stem.audioBufferId);
        const unregister = registrations.get(registrationKey);
        if (!unregister) {
            continue;
        }
        unregister();
        registrations.delete(registrationKey);
        agentRunLifecycle.forgetTemporaryAsset({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
        });
    }
}

async function discardRegisteredPreparedStemImportResources(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
}): Promise<void> {
    for (const stem of input.stems) {
        const registrationKey = key(input.runId, stem.audioBufferId);
        const asset = agentRunLifecycle
            .get(input.runId)
            ?.temporaryAssets.find((candidate) => candidate.assetId === stem.audioBufferId);
        if (!asset) {
            registrations.get(registrationKey)?.();
            registrations.delete(registrationKey);
            continue;
        }
        if (asset.status !== 'released') {
            await agentRunCancellation.cleanupTemporaryAsset({
                runId: input.runId,
                assetId: stem.audioBufferId,
                cleanupOwner: CLEANUP_OWNER,
            });
        }
        const currentAsset = agentRunLifecycle
            .get(input.runId)
            ?.temporaryAssets.find((candidate) => candidate.assetId === stem.audioBufferId);
        if (currentAsset?.status === 'released') {
            releasePreparedStemImportResources({ runId: input.runId, stems: [stem] });
        }
    }
}

export const preparedStemImportResources = {
    register: registerPreparedStemImportResources,
    release: releasePreparedStemImportResources,
    discard: discardRegisteredPreparedStemImportResources,
};
