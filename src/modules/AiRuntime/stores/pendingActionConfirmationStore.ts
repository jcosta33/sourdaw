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

export type PendingActionResourceLease = {
    bytes: number;
    release: () => Promise<void>;
};

const pendingActionResourceLeases = new Map<string, PendingActionResourceLease>();
const pendingActionResourceReleaseTasks = new Map<string, Promise<void>>();

async function releasePendingActionResourceLease(confirmationId: string): Promise<void> {
    const lease = pendingActionResourceLeases.get(confirmationId);
    if (!lease) {
        return;
    }
    const existingTask = pendingActionResourceReleaseTasks.get(confirmationId);
    if (existingTask) {
        await existingTask;
        return;
    }
    const task = lease.release().then(() => {
        if (pendingActionResourceLeases.get(confirmationId) === lease) {
            pendingActionResourceLeases.delete(confirmationId);
        }
    });
    pendingActionResourceReleaseTasks.set(confirmationId, task);
    try {
        await task;
    } finally {
        if (pendingActionResourceReleaseTasks.get(confirmationId) === task) {
            pendingActionResourceReleaseTasks.delete(confirmationId);
        }
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

export async function proposePendingActionConfirmation(
    input: ProposePendingActionConfirmationInput
): Promise<PendingAppActionConfirmation | null> {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        await input.resourceLease?.release();
        return null;
    }

    const preparedResourceBytes = [...pendingActionResourceLeases.values()].reduce(
        (total, lease) => total + lease.bytes,
        0
    );
    if (
        input.resourceLease &&
        (!Number.isSafeInteger(input.resourceLease.bytes) ||
            input.resourceLease.bytes < 0 ||
            preparedResourceBytes + input.resourceLease.bytes > MAX_PREPARED_RESOURCE_BYTES)
    ) {
        await input.resourceLease.release();
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

    const confirmationsWithNewEntry = [...state.confirmations, confirmation];
    const confirmations = confirmationsWithNewEntry.slice(-MAX_CONFIRMATIONS);
    const retainedIds = new Set(confirmations.map((entry) => entry.id));
    for (const evicted of confirmationsWithNewEntry) {
        if (!retainedIds.has(evicted.id)) {
            await releasePendingActionResourceLease(evicted.id);
        }
    }
    if (input.resourceLease) {
        pendingActionResourceLeases.set(confirmation.id, input.resourceLease);
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
    projectRevision?: string;
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
        followUpProjectRevision: input.projectRevision ?? current.followUpProjectRevision,
        followUpStatus: input.status,
    };
    pendingActionConfirmationStore.set({
        confirmations: state.confirmations.map((confirmation) =>
            confirmation.id === input.confirmationId ? updated : confirmation
        ),
    });
    return clonePendingActionConfirmation(updated);
}

export async function clearPendingActionConfirmations(): Promise<void> {
    for (const confirmationId of pendingActionResourceLeases.keys()) {
        await releasePendingActionResourceLease(confirmationId);
    }
    pendingActionConfirmationStore.set({ confirmations: [] });
}

type SettlePendingActionResourceLeaseInput = {
    confirmationId: string;
    disposition: 'discard' | 'retain';
};

export async function settlePendingActionResourceLease(input: SettlePendingActionResourceLeaseInput): Promise<void> {
    if (input.disposition === 'discard') {
        await releasePendingActionResourceLease(input.confirmationId);
        return;
    }
    pendingActionResourceLeases.delete(input.confirmationId);
}
