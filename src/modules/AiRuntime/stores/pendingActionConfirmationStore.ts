import { logger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';

import { type ChatActionConfirmationStatus, type ChatActionFollowUpStatus } from '../models/Chat';
import { type ExecutableRuntimeAction } from '../models/ExecutableRuntimeAction';

export type PendingActionExecution = {
    actionType: string;
    commandId?: string;
    commandSchemaVersion?: number;
    label: string;
    executionKind: 'project' | 'runtime';
    affectedIds: string[];
    applicationAssigned?: {
        ids: Array<{ field: string; value: string }>;
        timestamps: Array<{ field: string; value: number }>;
    };
    outcome: 'committed' | 'committed-with-warning' | 'executed' | 'executed-with-warning';
};

type PendingActionRisk = {
    level: string;
    reason: string | null;
};

type PendingActionProtectedObject = {
    id: string;
    name: string;
};

type PendingAgentRiskApproval = {
    schemaVersion: 1;
    actionHashes: string[];
    sourceRevision: string;
    targetFingerprints: Readonly<Record<string, string>>;
    advertisedTargetFingerprints: Readonly<Record<string, string>>;
    consequences: {
        audioUpload: boolean;
        fileAccess: boolean;
        maxImportedAssets: number;
        maxRenderJobs: number;
        remoteGeneration: boolean;
    };
    localActorId: string;
    policy: {
        decision: 'allow' | 'confirm';
        reasons: string[];
        requiredTrustMode:
            'analyze-only' | 'create-branch' | 'apply-reversible' | 'replace-selection' | 'destructive-commit';
        risk:
            | 'read-only'
            | 'bounded-reversible'
            | 'broad-reversible'
            | 'destructive-reversible'
            | 'authority-sensitive'
            | 'external-effect'
            | 'unclassified';
    };
};

type PendingCommandBatchAuthority = {
    projectId: string;
    baseRevision: string;
    scope: {
        targetIds: readonly string[];
        targetRanges: ReadonlyArray<{ startBeat: number; endBeat: number }>;
        protectedTargetIds: readonly string[];
        protectedRanges: ReadonlyArray<{ startBeat: number; endBeat: number }>;
    };
    grants: {
        allowedOperationPrefixes: readonly string[];
        create: boolean;
        delete: boolean;
        routing: boolean;
        tempo: boolean;
        master: boolean;
        file: boolean;
        audioUpload: boolean;
        remoteGeneration: boolean;
        autoCommit: boolean;
    };
    budgets: {
        maxCommands: number;
        maxCreatedTracks: number;
        maxDeletedObjects: number;
        maxAffectedTracks: number;
        maxAffectedClips: number;
        maxAutomationPoints: number;
        maxImportedAssets: number;
        maxRenderJobs: number;
    };
};

type PendingCommandBatch = {
    serialized: string;
    authority: PendingCommandBatchAuthority;
};

type PendingActionApprovalSnapshot = {
    actions: ExecutableRuntimeAction[];
    actionLabels: string[];
    commandEnvelopes?: string[];
    commandBatch?: PendingCommandBatch;
    agentApproval?: PendingAgentRiskApproval;
    protectedUnchanged: PendingActionProtectedObject[];
};

type PendingActionConfirmationBase = {
    id: string;
    runId: string;
    prompt: string;
    assistantMessageId: string;
    actionLabels: string[];
    affectedIds: string[];
    protectedUnchanged: PendingActionProtectedObject[];
    risk: PendingActionRisk | null;
    executedActions: PendingActionExecution[];
    status: ChatActionConfirmationStatus;
    error: string | null;
    followUpProjectRevision: string | null;
    followUpStatus: ChatActionFollowUpStatus | null;
    createdAt: number;
    resolvedAt: number | null;
};

export type PendingAppActionConfirmation = PendingActionConfirmationBase & {
    kind: 'app_actions';
    projectRevision: string;
    actions: ExecutableRuntimeAction[];
    approvalSnapshot: PendingActionApprovalSnapshot;
    executionMode: 'atomic' | undefined;
    groupId?: string;
    groupLabel?: string;
};

export type PendingActionConfirmationState = {
    confirmations: PendingAppActionConfirmation[];
};

export const pendingActionConfirmationStore = createStore<PendingActionConfirmationState>({
    initialData: { confirmations: [] },
});

const MAX_CONFIRMATIONS = 20;
const MAX_PREPARED_RESOURCE_BYTES = 2 * 1024 * 1024 * 1024;

type PendingActionResourceLease = {
    bytes: number;
    prepareForCommit?: (commandBatch?: PendingCommandBatch) => void | Promise<void>;
    protect?: () => void;
    commit?: () => void | Promise<void>;
    release: () => void | Promise<void>;
    retain?: () => void | Promise<void>;
    transfer?: () => void | Promise<void>;
};

type PendingActionResourceLeaseDisposition = 'pending' | 'prepared' | 'discard' | 'retain';
type PendingActionResourceReleaseAuthority = 'generic' | 'proven-noncommit';

type PendingActionResourceLeaseEntry = {
    lease: PendingActionResourceLease;
    disposition: PendingActionResourceLeaseDisposition;
    commitInFlight: Promise<void> | null;
    releaseInFlight: Promise<void> | null;
    retainInFlight: Promise<void> | null;
};

const pendingActionResourceLeases = new Map<string, PendingActionResourceLeaseEntry>();

type DetachedPendingActionResourceCleanupEntry = {
    lease: PendingActionResourceLease;
    releaseInFlight: Promise<void> | null;
    automaticAttempts: number;
};

const MAX_AUTOMATIC_DETACHED_RELEASE_ATTEMPTS = 2;
const detachedPendingActionResourceCleanups = new Map<
    PendingActionResourceLease,
    DetachedPendingActionResourceCleanupEntry
>();

function reportResourceReleaseFailure(error: unknown): void {
    logger.error(
        new Error('Confirmed AI action resource cleanup failed; the durable lease remains retryable', {
            cause: error,
        })
    );
}

async function releaseDetachedPendingActionResource(entry: DetachedPendingActionResourceCleanupEntry): Promise<void> {
    if (entry.releaseInFlight || !detachedPendingActionResourceCleanups.has(entry.lease)) {
        return;
    }
    entry.automaticAttempts += 1;
    try {
        entry.releaseInFlight = Promise.resolve(entry.lease.release());
    } catch (error) {
        entry.releaseInFlight = Promise.reject(error);
    }
    try {
        await entry.releaseInFlight;
        detachedPendingActionResourceCleanups.delete(entry.lease);
    } catch (error) {
        reportResourceReleaseFailure(error);
    } finally {
        entry.releaseInFlight = null;
    }
    if (
        detachedPendingActionResourceCleanups.has(entry.lease) &&
        entry.automaticAttempts < MAX_AUTOMATIC_DETACHED_RELEASE_ATTEMPTS
    ) {
        queueMicrotask(() => {
            void releaseDetachedPendingActionResource(entry);
        });
    }
}

function retainRejectedPendingActionResource(lease: PendingActionResourceLease): void {
    const existing = detachedPendingActionResourceCleanups.get(lease);
    const entry = existing ?? { lease, releaseInFlight: null, automaticAttempts: 0 };
    detachedPendingActionResourceCleanups.set(lease, entry);
    void releaseDetachedPendingActionResource(entry);
}

function retryDetachedPendingActionResourceCleanups(): void {
    for (const entry of detachedPendingActionResourceCleanups.values()) {
        if (entry.releaseInFlight) {
            continue;
        }
        entry.automaticAttempts = 0;
        void releaseDetachedPendingActionResource(entry);
    }
}

function getPreparedResourceBytes(): number {
    const leases = new Set([
        ...[...pendingActionResourceLeases.values()].map((entry) => entry.lease),
        ...detachedPendingActionResourceCleanups.keys(),
    ]);
    let total = 0;
    for (const lease of leases) {
        if (!Number.isSafeInteger(lease.bytes) || lease.bytes < 0) {
            return MAX_PREPARED_RESOURCE_BYTES + 1;
        }
        total += lease.bytes;
        if (total > MAX_PREPARED_RESOURCE_BYTES) {
            return MAX_PREPARED_RESOURCE_BYTES + 1;
        }
    }
    return total;
}

async function releasePendingActionResourceLease(
    confirmationId: string,
    authority: PendingActionResourceReleaseAuthority = 'generic'
): Promise<void> {
    const entry = pendingActionResourceLeases.get(confirmationId);
    if (!entry || entry.disposition === 'retain' || (entry.disposition === 'prepared' && authority === 'generic')) {
        return;
    }
    entry.disposition = 'discard';
    if (!entry.releaseInFlight) {
        try {
            entry.releaseInFlight = Promise.resolve(entry.lease.release());
        } catch (error) {
            entry.releaseInFlight = Promise.reject(error);
        }
        entry.releaseInFlight = entry.releaseInFlight.finally(() => {
            if (pendingActionResourceLeases.get(confirmationId) === entry) {
                entry.releaseInFlight = null;
            }
        });
    }
    await entry.releaseInFlight;
    if (pendingActionResourceLeases.get(confirmationId) === entry) {
        pendingActionResourceLeases.delete(confirmationId);
    }
}

function clonePendingActionConfirmation(confirmation: PendingAppActionConfirmation): PendingAppActionConfirmation {
    return structuredClone(confirmation);
}

type ProposePendingActionConfirmationInput = {
    id: string;
    runId?: string;
    prompt: string;
    assistantMessageId: string;
    actions: ExecutableRuntimeAction[];
    actionLabels: string[];
    commandEnvelopes?: string[];
    commandBatch?: PendingCommandBatch;
    agentApproval?: PendingAgentRiskApproval;
    affectedIds?: string[];
    protectedUnchanged?: PendingActionProtectedObject[];
    risk?: PendingActionRisk;
    executionMode?: 'atomic';
    groupId?: string;
    groupLabel?: string;
    projectRevision: string;
    resourceLease?: PendingActionResourceLease;
};

export function proposePendingActionConfirmation(
    input: ProposePendingActionConfirmationInput
): PendingAppActionConfirmation | null {
    retryDetachedPendingActionResourceCleanups();
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        if (input.resourceLease) {
            retainRejectedPendingActionResource(input.resourceLease);
        }
        return null;
    }

    const preparedResourceBytes = getPreparedResourceBytes();
    if (
        input.resourceLease &&
        (!Number.isSafeInteger(input.resourceLease.bytes) ||
            input.resourceLease.bytes < 0 ||
            preparedResourceBytes + input.resourceLease.bytes > MAX_PREPARED_RESOURCE_BYTES)
    ) {
        retainRejectedPendingActionResource(input.resourceLease);
        return null;
    }

    const approvalSnapshot: PendingActionApprovalSnapshot = {
        actions: structuredClone(input.actions),
        actionLabels: structuredClone(input.actionLabels),
        commandEnvelopes: input.commandEnvelopes ? [...input.commandEnvelopes] : undefined,
        commandBatch: input.commandBatch ? structuredClone(input.commandBatch) : undefined,
        agentApproval: input.agentApproval ? structuredClone(input.agentApproval) : undefined,
        protectedUnchanged: structuredClone(input.protectedUnchanged ?? []),
    };
    const confirmation: PendingAppActionConfirmation = {
        kind: 'app_actions',
        id: input.id,
        runId: input.runId ?? input.assistantMessageId,
        prompt: input.prompt,
        assistantMessageId: input.assistantMessageId,
        actions: structuredClone(approvalSnapshot.actions),
        approvalSnapshot,
        executionMode: input.executionMode,
        groupId: input.groupId,
        groupLabel: input.groupLabel,
        actionLabels: structuredClone(approvalSnapshot.actionLabels),
        affectedIds: [...(input.affectedIds ?? [])],
        protectedUnchanged: structuredClone(approvalSnapshot.protectedUnchanged),
        risk: input.risk ? { ...input.risk } : null,
        executedActions: [],
        status: 'proposed',
        error: null,
        followUpProjectRevision: null,
        followUpStatus: null,
        createdAt: Date.now(),
        resolvedAt: null,
        projectRevision: input.projectRevision,
    };

    if (input.resourceLease) {
        pendingActionResourceLeases.set(confirmation.id, {
            lease: input.resourceLease,
            disposition: 'pending',
            commitInFlight: null,
            releaseInFlight: null,
            retainInFlight: null,
        });
    }
    const confirmationsWithNewEntry = [...state.confirmations, confirmation];
    const confirmations = confirmationsWithNewEntry.slice(-MAX_CONFIRMATIONS);
    const retainedIds = new Set(confirmations.map((entry) => entry.id));
    for (const evicted of confirmationsWithNewEntry) {
        if (!retainedIds.has(evicted.id)) {
            void releasePendingActionResourceLease(evicted.id).catch(reportResourceReleaseFailure);
        }
    }
    pendingActionConfirmationStore.set({ confirmations });

    return clonePendingActionConfirmation(confirmation);
}

export function getPendingActionConfirmation(confirmationId: string): PendingAppActionConfirmation | null {
    const confirmation = pendingActionConfirmationStore.value?.confirmations.find(
        (candidate) => candidate.id === confirmationId
    );
    return confirmation ? clonePendingActionConfirmation(confirmation) : null;
}

export function hasRetryableSectionRenderFollowUp(input: {
    runId: string;
    batchId: string;
    commandId: string;
    serializedBatch: string;
}): boolean {
    return (
        pendingActionConfirmationStore.value?.confirmations.some(
            (confirmation) =>
                (confirmation.status === 'executed' || confirmation.status === 'failed') &&
                confirmation.runId === input.runId &&
                confirmation.groupId === input.batchId &&
                confirmation.followUpStatus === 'retryable' &&
                confirmation.followUpProjectRevision !== null &&
                confirmation.approvalSnapshot.commandBatch?.serialized === input.serializedBatch &&
                confirmation.approvalSnapshot.actions.filter((action) => action.type === 'renderProjectSections')
                    .length === 1 &&
                confirmation.executedActions.filter(
                    (execution) =>
                        execution.actionType === 'renderProjectSections' &&
                        execution.commandId === input.commandId &&
                        execution.executionKind === 'project'
                ).length === 1
        ) ?? false
    );
}

type RefreshPendingActionConfirmationApprovalInput = {
    agentApproval: PendingAgentRiskApproval;
    commandBatch: PendingCommandBatch;
    commandEnvelopes: readonly string[];
    confirmationId: string;
    projectRevision: string;
};

export function refreshPendingActionConfirmationApproval(
    input: RefreshPendingActionConfirmationApprovalInput
): PendingAppActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }
    const current = state.confirmations.find((confirmation) => confirmation.id === input.confirmationId);
    if (!current || current.status !== 'proposed') {
        return null;
    }
    const updated: PendingAppActionConfirmation = {
        ...current,
        approvalSnapshot: {
            ...current.approvalSnapshot,
            agentApproval: structuredClone(input.agentApproval),
            commandBatch: structuredClone(input.commandBatch),
            commandEnvelopes: [...input.commandEnvelopes],
        },
        error: null,
        projectRevision: input.projectRevision,
        resolvedAt: null,
        risk: {
            level: input.agentApproval.policy.risk,
            reason: input.agentApproval.policy.reasons.join(' ') || null,
        },
        status: 'proposed',
    };
    pendingActionConfirmationStore.set({
        confirmations: state.confirmations.map((confirmation) =>
            confirmation.id === input.confirmationId ? updated : confirmation
        ),
    });
    return clonePendingActionConfirmation(updated);
}

type RecordPendingActionExecutionInput = {
    confirmationId: string;
    execution: PendingActionExecution;
};

export function recordPendingActionExecution(
    input: RecordPendingActionExecutionInput
): PendingAppActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }

    const current = state.confirmations.find((confirmation) => confirmation.id === input.confirmationId);
    if (!current) {
        return null;
    }

    const updated: PendingAppActionConfirmation = {
        ...current,
        executedActions: [...current.executedActions, structuredClone(input.execution)],
    };
    const confirmations = state.confirmations.map((confirmation) => {
        if (confirmation.id !== input.confirmationId) {
            return confirmation;
        }

        return updated;
    });

    pendingActionConfirmationStore.set({ confirmations });
    return clonePendingActionConfirmation(updated);
}

type ReplacePendingActionExecutionsInput = {
    confirmationId: string;
    executions: readonly PendingActionExecution[];
};

export function replacePendingActionExecutions(
    input: ReplacePendingActionExecutionsInput
): PendingAppActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }
    const current = state.confirmations.find((confirmation) => confirmation.id === input.confirmationId);
    if (!current) {
        return null;
    }
    const updated: PendingAppActionConfirmation = {
        ...current,
        executedActions: structuredClone([...input.executions]),
    };
    pendingActionConfirmationStore.set({
        confirmations: state.confirmations.map((confirmation) =>
            confirmation.id === input.confirmationId ? updated : confirmation
        ),
    });
    return clonePendingActionConfirmation(updated);
}

type UpdatePendingActionConfirmationStatusInput = {
    confirmationId: string;
    status: ChatActionConfirmationStatus;
    error?: string;
};

export function updatePendingActionConfirmationStatus(
    input: UpdatePendingActionConfirmationStatusInput
): PendingAppActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }

    const current = state.confirmations.find((confirmation) => confirmation.id === input.confirmationId);
    if (!current) {
        return null;
    }

    const updated: PendingAppActionConfirmation = {
        ...current,
        status: input.status,
        error: input.error ?? null,
        resolvedAt: input.status === 'proposed' || input.status === 'accepted' ? null : Date.now(),
    };
    const confirmations = state.confirmations.map((confirmation) => {
        if (confirmation.id !== input.confirmationId) {
            return confirmation;
        }

        return updated;
    });

    pendingActionConfirmationStore.set({ confirmations });
    return clonePendingActionConfirmation(updated);
}

type UpdatePendingActionFollowUpInput = {
    confirmationId: string;
    error?: string | null;
    projectRevision?: string | null;
    status: ChatActionFollowUpStatus;
};

export function updatePendingActionFollowUp(
    input: UpdatePendingActionFollowUpInput
): PendingAppActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }
    const current = state.confirmations.find((confirmation) => confirmation.id === input.confirmationId);
    if (!current) {
        return null;
    }
    const updated: PendingAppActionConfirmation = {
        ...current,
        error: input.error === undefined ? current.error : input.error,
        followUpProjectRevision:
            input.projectRevision === undefined ? current.followUpProjectRevision : input.projectRevision,
        followUpStatus: input.status,
    };
    pendingActionConfirmationStore.set({
        confirmations: state.confirmations.map((confirmation) =>
            confirmation.id === input.confirmationId ? updated : confirmation
        ),
    });
    return clonePendingActionConfirmation(updated);
}

export function clearPendingActionConfirmations(): void {
    for (const confirmationId of pendingActionResourceLeases.keys()) {
        void releasePendingActionResourceLease(confirmationId).catch(reportResourceReleaseFailure);
    }
    retryDetachedPendingActionResourceCleanups();
    pendingActionConfirmationStore.set({ confirmations: [] });
}

/** Persist resource recovery ownership before the project command may commit. */
export async function preparePendingActionResourceLeaseForCommit(
    confirmationId: string,
    commandBatch?: PendingCommandBatch
): Promise<void> {
    await pendingActionResourceLeases.get(confirmationId)?.lease.prepareForCommit?.(commandBatch);
}

/** Mark a prepared resource recovery executable only after the command produced a verified commit receipt. */
export async function commitPendingActionResourceLease(confirmationId: string): Promise<void> {
    const entry = pendingActionResourceLeases.get(confirmationId);
    if (!entry) {
        return;
    }
    if (entry.disposition === 'discard') {
        throw new Error('Confirmed AI action resource cleanup already owns this lease');
    }
    entry.disposition = 'retain';
    entry.commitInFlight ??= Promise.resolve()
        .then(() => entry.lease.commit?.())
        .finally(() => {
            if (pendingActionResourceLeases.get(confirmationId) === entry) {
                entry.commitInFlight = null;
            }
        });
    await entry.commitInFlight;
}

export function protectPendingActionResourceLease(confirmationId: string): void {
    const entry = pendingActionResourceLeases.get(confirmationId);
    if (!entry || entry.disposition === 'discard' || entry.disposition === 'retain') {
        return;
    }
    entry.disposition = 'prepared';
    entry.lease.protect?.();
}

type SettlePendingActionResourceLeaseInput = {
    confirmationId: string;
    disposition: 'discard' | 'retain' | 'transfer';
};

export async function settlePendingActionResourceLease(input: SettlePendingActionResourceLeaseInput): Promise<void> {
    if (input.disposition === 'discard') {
        await releasePendingActionResourceLease(input.confirmationId, 'proven-noncommit');
        return;
    }
    const entry = pendingActionResourceLeases.get(input.confirmationId);
    if (!entry) {
        return;
    }
    if (entry.disposition === 'discard') {
        return;
    }
    entry.disposition = 'retain';
    const settle = input.disposition === 'transfer' ? (entry.lease.transfer ?? entry.lease.retain) : entry.lease.retain;
    entry.retainInFlight ??= Promise.resolve()
        .then(() => settle?.())
        .then(() => {
            if (pendingActionResourceLeases.get(input.confirmationId) === entry) {
                pendingActionResourceLeases.delete(input.confirmationId);
            }
        })
        .finally(() => {
            if (pendingActionResourceLeases.get(input.confirmationId) === entry) {
                entry.retainInFlight = null;
            }
        });
    await entry.retainInFlight;
}

/** Settle without replacing the caller's primary outcome; failed leases stay registered for retry. */
export async function settlePendingActionResourceLeaseBestEffort(
    input: SettlePendingActionResourceLeaseInput
): Promise<void> {
    try {
        await settlePendingActionResourceLease(input);
    } catch (error) {
        reportResourceReleaseFailure(error);
    }
}
