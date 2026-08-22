import { type getVersionedCommandBatchIdempotentReplay } from '#/modules/Command/useCases';

import {
    AGENT_RUN_PREPARED_STEM_IMPORT_RECOVERY_SCHEMA_VERSION,
    type AgentRunPreparedStemImportRecovery,
} from '../../models/AgentRun';
import { type StemImportPromptScope } from '../../models/StemImportCapability';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { getVerifiedBatchReplayDisposition } from '../getVerifiedBatchReplayDisposition';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

const CLEANUP_OWNER = 'stem-import-preparation';
type PreparedStemImportResource = Pick<
    StemImportPromptScope['actionSeed']['stems'][number],
    'assetLeaseId' | 'audioBufferId'
>;
type PreparedStemImportRecoveryBinding = {
    batchId: string;
    commandBatch: Parameters<typeof getVersionedCommandBatchIdempotentReplay>[0];
};
type PreparedStemImportRegistration = {
    unregister: () => void;
    protected: boolean;
    stem: PreparedStemImportResource;
    recovery: PreparedStemImportRecoveryBinding | null;
};
const registrations = new Map<string, PreparedStemImportRegistration>();
type PreparedStemImportRecoveryResult = { status: 'discarded' | 'missing' | 'retained' | 'transferred' };
const reconciliations = new Map<string, Promise<PreparedStemImportRecoveryResult>>();

function key(runId: string, assetId: string): string {
    return `${runId}\u0000${assetId}`;
}

function createRegistration(input: {
    runId: string;
    stem: PreparedStemImportResource;
    protected: boolean;
    recovery: PreparedStemImportRecoveryBinding | null;
}): PreparedStemImportRegistration {
    const registrationKey = key(input.runId, input.stem.audioBufferId);
    const registration: PreparedStemImportRegistration = {
        unregister: () => undefined,
        protected: input.protected,
        stem: input.stem,
        recovery: input.recovery,
    };
    registration.unregister = agentRunCancellation.registerTemporaryAssetCleanup({
        runId: input.runId,
        assetId: input.stem.audioBufferId,
        cleanupOwner: CLEANUP_OWNER,
        cleanup: () => {
            if (registrations.get(registrationKey)?.protected) {
                throw new Error('Prepared stem cleanup is deferred until command commit truth is reconciled.');
            }
            discardPreparedStemImportResources([input.stem]);
        },
    });
    return registration;
}

function registerPreparedStemImportResources(input: {
    runId: string;
    stems: readonly PreparedStemImportResource[];
}): void {
    for (const stem of input.stems) {
        const registrationKey = key(input.runId, stem.audioBufferId);
        agentRunLifecycle.registerTemporaryAsset({
            runId: input.runId,
            assetId: stem.audioBufferId,
            kind: 'import',
            cleanupOwner: CLEANUP_OWNER,
        });
        registrations.set(
            registrationKey,
            createRegistration({ runId: input.runId, stem, protected: false, recovery: null })
        );
    }
}

function hydratePreparedStemImportResources(input: {
    runId: string;
    recovery: AgentRunPreparedStemImportRecovery;
    commandBatch: Parameters<typeof getVersionedCommandBatchIdempotentReplay>[0];
}): boolean {
    const run = agentRunLifecycle.get(input.runId);
    if (
        !run ||
        input.recovery.resources.some(
            (resource) =>
                !run.temporaryAssets.some(
                    (asset) =>
                        asset.assetId === resource.audioBufferId &&
                        asset.kind === 'import' &&
                        asset.cleanupOwner === CLEANUP_OWNER &&
                        asset.status !== 'released'
                )
        )
    ) {
        return false;
    }
    const recovery = { batchId: input.recovery.batchId, commandBatch: input.commandBatch };
    for (const resource of input.recovery.resources) {
        const stem: PreparedStemImportResource = {
            audioBufferId: resource.audioBufferId,
            ...(resource.assetLeaseId === null ? {} : { assetLeaseId: resource.assetLeaseId }),
        };
        const registrationKey = key(input.runId, resource.audioBufferId);
        const existing = registrations.get(registrationKey);
        if (existing) {
            existing.protected = true;
            existing.recovery = recovery;
            continue;
        }
        registrations.set(registrationKey, createRegistration({ runId: input.runId, stem, protected: true, recovery }));
    }
    return true;
}

function persistPreparedStemImportRecovery(input: {
    runId: string;
    stems: readonly PreparedStemImportResource[];
    recovery: PreparedStemImportRecoveryBinding;
}): void {
    agentRunLifecycle.recordPreparedStemImportRecovery({
        runId: input.runId,
        recovery: {
            schemaVersion: AGENT_RUN_PREPARED_STEM_IMPORT_RECOVERY_SCHEMA_VERSION,
            batchId: input.recovery.batchId,
            serializedCommandBatch: input.recovery.commandBatch.serialized,
            resources: input.stems.map((stem) => ({
                audioBufferId: stem.audioBufferId,
                assetLeaseId: stem.assetLeaseId ?? null,
            })),
        },
    });
}

function forgetSettledRecoveries(runId: string, batchIds: ReadonlySet<string>): void {
    for (const batchId of batchIds) {
        if (
            [...registrations.entries()].some(
                ([registrationKey, registration]) =>
                    registrationKey.startsWith(`${runId}\u0000`) && registration.recovery?.batchId === batchId
            )
        ) {
            continue;
        }
        if (agentRunLifecycle.get(runId)?.preparedStemImports.some((recovery) => recovery.batchId === batchId)) {
            agentRunLifecycle.forgetPreparedStemImportRecovery({ runId, batchId });
        }
    }
}

function protectPreparedStemImportResources(input: {
    runId: string;
    stems: readonly PreparedStemImportResource[];
    recovery?: PreparedStemImportRecoveryBinding;
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
    if (input.recovery && input.stems.length > 0) {
        try {
            persistPreparedStemImportRecovery({ ...input, recovery: input.recovery });
        } catch {
            try {
                agentRunLifecycle.requirePreparedStemManualRepair({
                    runId: input.runId,
                    assetIds: input.stems.map((stem) => stem.audioBufferId),
                    batchIds: [input.recovery.batchId],
                });
            } catch {
                // Protection remains authoritative in memory. A persistence outage must
                // never turn post-commit cleanup into physical deletion.
            }
        }
    }
}

function retainPreparedStemImportResourcesForRecovery(input: {
    runId: string;
    stems: readonly PreparedStemImportResource[];
    recovery?: PreparedStemImportRecoveryBinding;
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
    stems: readonly PreparedStemImportResource[];
}): void {
    const settledBatchIds = new Set<string>();
    for (const stem of input.stems) {
        const registrationKey = key(input.runId, stem.audioBufferId);
        const registration = registrations.get(registrationKey);
        if (!registration) {
            continue;
        }
        if (registration.recovery) {
            settledBatchIds.add(registration.recovery.batchId);
        }
        registration.unregister();
        registrations.delete(registrationKey);
        agentRunLifecycle.forgetTemporaryAsset({
            runId: input.runId,
            assetId: stem.audioBufferId,
            cleanupOwner: CLEANUP_OWNER,
        });
    }
    forgetSettledRecoveries(input.runId, settledBatchIds);
}

async function discardRegisteredPreparedStemImportResources(input: {
    runId: string;
    stems: readonly PreparedStemImportResource[];
}): Promise<void> {
    const settledBatchIds = new Set<string>();
    for (const stem of input.stems) {
        const registrationKey = key(input.runId, stem.audioBufferId);
        const registration = registrations.get(registrationKey);
        if (registration?.recovery) {
            settledBatchIds.add(registration.recovery.batchId);
        }
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
    forgetSettledRecoveries(input.runId, settledBatchIds);
}

export const preparedStemImportResources = {
    register: registerPreparedStemImportResources,
    hydrate: hydratePreparedStemImportResources,
    protect: protectPreparedStemImportResources,
    retainForRecovery: retainPreparedStemImportResourcesForRecovery,
    reconcile: reconcilePreparedStemImportResources,
    release: releasePreparedStemImportResources,
    discard: discardRegisteredPreparedStemImportResources,
};
