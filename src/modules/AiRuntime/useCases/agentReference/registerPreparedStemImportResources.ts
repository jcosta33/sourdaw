import { type getVersionedCommandBatchIdempotentReplay } from '#/modules/Command/useCases';

import { type StemImportPromptScope } from '../../models/StemImportCapability';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { getVerifiedBatchReplayDisposition } from '../getVerifiedBatchReplayDisposition';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

const CLEANUP_OWNER = 'stem-import-preparation';
type PreparedStemImportRegistration = {
    unregister: () => void;
    protected: boolean;
    stem: StemImportPromptScope['actionSeed']['stems'][number];
    recovery: {
        batchId: string;
        commandBatch: Parameters<typeof getVersionedCommandBatchIdempotentReplay>[0];
    } | null;
};
const registrations = new Map<string, PreparedStemImportRegistration>();
type PreparedStemImportRecoveryResult = { status: 'discarded' | 'missing' | 'retained' | 'transferred' };
const reconciliations = new Map<string, Promise<PreparedStemImportRecoveryResult>>();

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
        const registration: PreparedStemImportRegistration = {
            unregister: () => undefined,
            protected: false,
            stem,
            recovery: null,
        };
        registration.unregister = agentRunCancellation.registerTemporaryAssetCleanup({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
            cleanup: () => {
                if (registrations.get(registrationKey)?.protected) {
                    throw new Error('Prepared stem cleanup is deferred until command commit truth is reconciled.');
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
    recovery?: {
        batchId: string;
        commandBatch: Parameters<typeof getVersionedCommandBatchIdempotentReplay>[0];
    };
}): void {
    for (const stem of input.stems) {
        const registration = registrations.get(key(input.runId, stem.audioBufferId));
        if (registration) {
            registration.protected = true;
            if (input.recovery) {
                registration.recovery = input.recovery;
            }
        }
    }
}

function retainPreparedStemImportResourcesForRecovery(input: {
    runId: string;
    stems: StemImportPromptScope['actionSeed']['stems'];
    recovery?: {
        batchId: string;
        commandBatch: Parameters<typeof getVersionedCommandBatchIdempotentReplay>[0];
    };
}): void {
    protectPreparedStemImportResources(input);
    for (const stem of input.stems) {
        const asset = agentRunLifecycle
            .get(input.runId)
            ?.temporaryAssets.find((candidate) => candidate.assetId === stem.audioBufferId);
        if (!asset || asset.status === 'released') {
            continue;
        }
        agentRunLifecycle.prepareTemporaryAssetCleanup({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
        });
    }
}

async function reconcilePreparedStemImportResourcesOnce(input: {
    runId: string;
    batchId: string;
    getVerifiedReceipt: (
        commandBatch: Parameters<typeof getVersionedCommandBatchIdempotentReplay>[0]
    ) => ReturnType<typeof getVersionedCommandBatchIdempotentReplay>;
}): Promise<PreparedStemImportRecoveryResult> {
    const registrationsForBatch = [...registrations.entries()].filter(
        ([registrationKey, registration]) =>
            registrationKey.startsWith(`${input.runId}\u0000`) && registration.recovery?.batchId === input.batchId
    );
    const recovery = registrationsForBatch[0]?.[1].recovery;
    if (!recovery) {
        return { status: 'missing' };
    }
    const stems = registrationsForBatch.map(([, registration]) => registration.stem);
    const receipt = await input.getVerifiedReceipt(recovery.commandBatch);
    if (!receipt || receipt.runId !== input.runId || receipt.batchId !== input.batchId) {
        retainPreparedStemImportResourcesForRecovery({ runId: input.runId, stems });
        return { status: 'retained' };
    }
    const disposition = getVerifiedBatchReplayDisposition(receipt);
    if (disposition.status === 'committed' || disposition.status === 'executed') {
        releasePreparedStemImportResources({ runId: input.runId, stems });
        return { status: 'transferred' };
    }
    if (disposition.status === 'ambiguous') {
        retainPreparedStemImportResourcesForRecovery({ runId: input.runId, stems });
        return { status: 'retained' };
    }
    await discardRegisteredPreparedStemImportResources({ runId: input.runId, stems });
    return { status: 'discarded' };
}

function reconcilePreparedStemImportResources(input: {
    runId: string;
    batchId: string;
    getVerifiedReceipt: (
        commandBatch: Parameters<typeof getVersionedCommandBatchIdempotentReplay>[0]
    ) => ReturnType<typeof getVersionedCommandBatchIdempotentReplay>;
}): Promise<PreparedStemImportRecoveryResult> {
    const reconciliationKey = key(input.runId, input.batchId);
    const active = reconciliations.get(reconciliationKey);
    if (active) {
        return active;
    }
    const reconciliation = reconcilePreparedStemImportResourcesOnce(input).finally(() => {
        if (reconciliations.get(reconciliationKey) === reconciliation) {
            reconciliations.delete(reconciliationKey);
        }
    });
    reconciliations.set(reconciliationKey, reconciliation);
    return reconciliation;
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
    retainForRecovery: retainPreparedStemImportResourcesForRecovery,
    reconcile: reconcilePreparedStemImportResources,
    release: releasePreparedStemImportResources,
    discard: discardRegisteredPreparedStemImportResources,
};
