import { type StemImportPromptScope } from '../../models/StemImportCapability';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

const CLEANUP_OWNER = 'stem-import-preparation';
type PreparedStemImportRegistration = {
    unregister: () => void;
    protected: boolean;
};
const registrations = new Map<string, PreparedStemImportRegistration>();

function key(runId: string, assetId: string): string {
    return `${runId}\u0000${assetId}`;
}

function registerPreparedStemImportResources(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
}): void {
    for (const stem of input.stems) {
        const registrationKey = key(input.runId, stem.audioBufferId);
        agentRunLifecycle.registerTemporaryAsset({
            runId: input.runId,
            assetId: stem.audioBufferId,
            kind: 'import',
            cleanupOwner: CLEANUP_OWNER,
        });
        const registration: PreparedStemImportRegistration = { unregister: () => undefined, protected: false };
        registration.unregister = agentRunCancellation.registerTemporaryAssetCleanup({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
            cleanup: () => {
                if (registrations.get(registrationKey)?.protected) {
                    return;
                }
                discardPreparedStemImportResources([stem]);
            },
        });
        registrations.set(registrationKey, registration);
    }
}

function protectPreparedStemImportResources(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
}): void {
    for (const stem of input.stems) {
        const registration = registrations.get(key(input.runId, stem.audioBufferId));
        if (registration) {
            registration.protected = true;
        }
    }
}

function releasePreparedStemImportResources(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
}): void {
    for (const stem of input.stems) {
        const registrationKey = key(input.runId, stem.audioBufferId);
        const registration = registrations.get(registrationKey);
        if (!registration) {
            continue;
        }
        registration.unregister();
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
        const registration = registrations.get(registrationKey);
        const asset = agentRunLifecycle
            .get(input.runId)
            ?.temporaryAssets.find((candidate) => candidate.assetId === stem.audioBufferId);
        if (!asset) {
            registration?.unregister();
            registrations.delete(registrationKey);
            continue;
        }
        if (registration?.protected) {
            discardPreparedStemImportResources([stem]);
            registration.unregister();
            registrations.delete(registrationKey);
            agentRunLifecycle.forgetTemporaryAsset({
                runId: input.runId,
                assetId: stem.audioBufferId,
                cleanupOwner: CLEANUP_OWNER,
            });
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
    protect: protectPreparedStemImportResources,
    release: releasePreparedStemImportResources,
    discard: discardRegisteredPreparedStemImportResources,
};
