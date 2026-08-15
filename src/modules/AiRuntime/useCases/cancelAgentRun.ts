import { type AgentRunPhase, type AgentRunWorkLease } from '../models/AgentRun';

import { agentRunLifecycle } from './agentRunLifecycle';

type CancellationAcknowledgement = 'transport' | 'backend';

type WorkCancellationRegistration = {
    lease: AgentRunWorkLease;
    cancel: () => CancellationAcknowledgement | void | Promise<CancellationAcknowledgement | void>;
};

type TemporaryAssetCleanupRegistrationInput = {
    runId: string;
    assetId: string;
    cleanupOwner: string;
    cleanup: () => void | Promise<void>;
};

type TemporaryAssetCleanupRegistration = TemporaryAssetCleanupRegistrationInput & {
    inFlight: boolean;
};

const workCancellationRegistrations = new Map<string, WorkCancellationRegistration>();
const temporaryAssetCleanupRegistrations = new Map<string, TemporaryAssetCleanupRegistration>();

const TERMINAL_PHASES = new Set<AgentRunPhase>(['completed', 'failed', 'cancelled', 'partially-completed']);

function temporaryAssetKey(runId: string, assetId: string): string {
    return `${runId}\u0000${assetId}`;
}

function registerAgentRunWorkCancellation(input: WorkCancellationRegistration): () => void {
    const run = agentRunLifecycle.get(input.lease.runId);
    const activeLease = run?.workLeases.find(
        (lease) =>
            lease.leaseId === input.lease.leaseId &&
            lease.workId === input.lease.workId &&
            lease.cancellationGeneration === input.lease.cancellationGeneration &&
            lease.terminalState === null
    );
    if (!activeLease) {
        throw new Error(`Agent work lease is not active: ${input.lease.leaseId}`);
    }
    if (workCancellationRegistrations.has(input.lease.leaseId)) {
        throw new Error(`Agent work lease already has a cancellation owner: ${input.lease.leaseId}`);
    }
    const registration = { lease: structuredClone(input.lease), cancel: input.cancel };
    workCancellationRegistrations.set(input.lease.leaseId, registration);
    return () => {
        if (workCancellationRegistrations.get(input.lease.leaseId) === registration) {
            workCancellationRegistrations.delete(input.lease.leaseId);
        }
    };
}

function registerAgentRunTemporaryAssetCleanup(input: TemporaryAssetCleanupRegistrationInput): () => void {
    const key = temporaryAssetKey(input.runId, input.assetId);
    if (temporaryAssetCleanupRegistrations.has(key)) {
        throw new Error(`Agent temporary asset already has a cleanup owner: ${input.assetId}`);
    }
    const asset = agentRunLifecycle
        .get(input.runId)
        ?.temporaryAssets.find((candidate) => candidate.assetId === input.assetId);
    if (!asset || (asset.status !== 'live' && asset.status !== 'cleanup-pending')) {
        throw new Error(`Agent temporary asset is not available for cleanup: ${input.assetId}`);
    }
    if (asset.cleanupOwner !== input.cleanupOwner) {
        throw new Error(`Agent temporary asset cleanup owner does not match: ${input.assetId}`);
    }
    const registration = { ...input, inFlight: false };
    temporaryAssetCleanupRegistrations.set(key, registration);
    return () => {
        if (temporaryAssetCleanupRegistrations.get(key) === registration && !registration.inFlight) {
            temporaryAssetCleanupRegistrations.delete(key);
        }
    };
}

type CancelAgentRunResult =
    | { status: 'missing' }
    | { status: 'already-terminal'; phase: AgentRunPhase }
    | {
          status: 'cancelled';
          phase: 'cancelled' | 'partially-completed';
          cancelledWorkIds: string[];
          cleanupPendingAssetIds: string[];
          releasedAssetIds: string[];
      };

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown cancellation owner failure';
}

function recordCancellationAcknowledgement(input: {
    runId: string;
    acknowledgement: CancellationAcknowledgement | void;
    acknowledgedAt: number;
}): void {
    if (input.acknowledgement === 'transport' || input.acknowledgement === 'backend') {
        agentRunLifecycle.acknowledgeCancellation({
            runId: input.runId,
            level: 'transport',
            acknowledgedAt: input.acknowledgedAt,
        });
    }
    if (input.acknowledgement === 'backend') {
        agentRunLifecycle.acknowledgeCancellation({
            runId: input.runId,
            level: 'backend',
            acknowledgedAt: input.acknowledgedAt,
        });
    }
}

function recordCancellationFailure(input: { runId: string; workId: string; error: unknown; occurredAt: number }): void {
    agentRunLifecycle.recordError({
        runId: input.runId,
        error: {
            code: 'work-cancellation-failed',
            message: getErrorMessage(input.error),
            occurredAt: input.occurredAt,
            retriable: false,
            workId: input.workId,
        },
    });
}

function bindAgentRunAbortController(input: {
    runId: string;
    lease: AgentRunWorkLease;
    controller: AbortController;
    reason: string;
}): () => void {
    const unregisterCancellation = registerAgentRunWorkCancellation({
        lease: input.lease,
        cancel: () => {
            if (!input.controller.signal.aborted) {
                input.controller.abort(new DOMException(input.reason, 'AbortError'));
            }
            return 'transport';
        },
    });
    const cancelRun = () => {
        void cancelAgentRun({ runId: input.runId, reason: input.reason }).catch(() => undefined);
    };
    input.controller.signal.addEventListener('abort', cancelRun, { once: true });
    return () => {
        input.controller.signal.removeEventListener('abort', cancelRun);
        unregisterCancellation();
    };
}

async function cancelAgentRun(input: {
    runId: string;
    reason: string;
    requestedAt?: number;
}): Promise<CancelAgentRunResult> {
    const run = agentRunLifecycle.get(input.runId);
    if (!run) {
        return { status: 'missing' };
    }
    const retryingPendingCleanup =
        (run.phase === 'cancelled' || run.phase === 'partially-completed') &&
        run.temporaryAssets.some((asset) => asset.status === 'cleanup-pending');
    if (TERMINAL_PHASES.has(run.phase) && !retryingPendingCleanup) {
        return { status: 'already-terminal', phase: run.phase };
    }

    const requestedAt = input.requestedAt ?? Date.now();
    const activeLeases = run.workLeases.filter((lease) => lease.terminalState === null);
    const cleanupAssets = run.temporaryAssets.filter(
        (asset) => asset.status === 'live' || (retryingPendingCleanup && asset.status === 'cleanup-pending')
    );

    // Revoke durable authority before notifying any external owner. A callback
    // that races this function can only present the now-stale generation.
    if (!retryingPendingCleanup) {
        agentRunLifecycle.cancel({ runId: input.runId, reason: input.reason, requestedAt });
    }

    const cancelledWorkIds: string[] = [];
    for (const lease of activeLeases) {
        const registration = workCancellationRegistrations.get(lease.leaseId);
        if (
            !registration ||
            registration.lease.runId !== input.runId ||
            registration.lease.workId !== lease.workId ||
            registration.lease.cancellationGeneration !== lease.cancellationGeneration
        ) {
            continue;
        }
        workCancellationRegistrations.delete(lease.leaseId);
        try {
            const acknowledgement = registration.cancel();
            cancelledWorkIds.push(lease.workId);
            if (acknowledgement instanceof Promise) {
                void acknowledgement
                    .then((value) => {
                        recordCancellationAcknowledgement({
                            runId: input.runId,
                            acknowledgement: value,
                            acknowledgedAt: requestedAt,
                        });
                    })
                    .catch((error: unknown) => {
                        recordCancellationFailure({
                            runId: input.runId,
                            workId: lease.workId,
                            error,
                            occurredAt: requestedAt,
                        });
                    });
            } else {
                recordCancellationAcknowledgement({
                    runId: input.runId,
                    acknowledgement,
                    acknowledgedAt: requestedAt,
                });
            }
        } catch (error) {
            recordCancellationFailure({
                runId: input.runId,
                workId: lease.workId,
                error,
                occurredAt: requestedAt,
            });
        }
    }

    const releasedAssetIds: string[] = [];
    for (const asset of cleanupAssets) {
        const key = temporaryAssetKey(input.runId, asset.assetId);
        const registration = temporaryAssetCleanupRegistrations.get(key);
        if (!registration || registration.cleanupOwner !== asset.cleanupOwner || registration.inFlight) {
            continue;
        }
        registration.inFlight = true;
        try {
            await registration.cleanup();
            agentRunLifecycle.releaseTemporaryAsset({
                runId: input.runId,
                assetId: asset.assetId,
                cleanupOwner: asset.cleanupOwner,
                releasedAt: requestedAt,
            });
            releasedAssetIds.push(asset.assetId);
            if (temporaryAssetCleanupRegistrations.get(key) === registration) {
                temporaryAssetCleanupRegistrations.delete(key);
            }
        } catch (error) {
            registration.inFlight = false;
            agentRunLifecycle.recordError({
                runId: input.runId,
                error: {
                    code: 'temporary-asset-cleanup-failed',
                    message: getErrorMessage(error),
                    occurredAt: requestedAt,
                    retriable: true,
                    workId: null,
                },
            });
        }
    }

    const finalRun = agentRunLifecycle.get(input.runId);
    if (!finalRun || (finalRun.phase !== 'cancelled' && finalRun.phase !== 'partially-completed')) {
        throw new Error(`Agent run cancellation did not reach a terminal phase: ${input.runId}`);
    }
    return {
        status: 'cancelled',
        phase: finalRun.phase,
        cancelledWorkIds,
        cleanupPendingAssetIds: finalRun.temporaryAssets
            .filter((asset) => asset.status === 'cleanup-pending')
            .map((asset) => asset.assetId),
        releasedAssetIds,
    };
}

export const agentRunCancellation = {
    bindAbortController: bindAgentRunAbortController,
    cancel: cancelAgentRun,
    registerTemporaryAssetCleanup: registerAgentRunTemporaryAssetCleanup,
    registerWorkCancellation: registerAgentRunWorkCancellation,
} as const;
