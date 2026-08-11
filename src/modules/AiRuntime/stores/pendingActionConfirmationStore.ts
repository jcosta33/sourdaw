import { createStore } from '#/infra/store/createStore';

import { type ChatActionConfirmationStatus, type ChatActionFollowUpStatus } from '../models/Chat';
import { type ExecutableRuntimeAction } from '../models/ExecutableRuntimeAction';

export type PendingActionExecution = {
    actionType: string;
    label: string;
    executionKind: 'project' | 'runtime';
    affectedIds: string[];
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

type PendingActionApprovalSnapshot = {
    actions: ExecutableRuntimeAction[];
    actionLabels: string[];
    protectedUnchanged: PendingActionProtectedObject[];
};

type PendingActionConfirmationBase = {
    id: string;
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
};

export type PendingActionConfirmationState = {
    confirmations: PendingAppActionConfirmation[];
};

export const pendingActionConfirmationStore = createStore<PendingActionConfirmationState>({
    initialData: { confirmations: [] },
});

const MAX_CONFIRMATIONS = 20;

function clonePendingActionConfirmation(confirmation: PendingAppActionConfirmation): PendingAppActionConfirmation {
    return structuredClone(confirmation);
}

type ProposePendingActionConfirmationInput = {
    id: string;
    prompt: string;
    assistantMessageId: string;
    actions: ExecutableRuntimeAction[];
    actionLabels: string[];
    affectedIds?: string[];
    protectedUnchanged?: PendingActionProtectedObject[];
    risk?: PendingActionRisk;
    executionMode?: 'atomic';
    projectRevision: string;
};

export function proposePendingActionConfirmation(
    input: ProposePendingActionConfirmationInput
): PendingAppActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }

    const approvalSnapshot: PendingActionApprovalSnapshot = {
        actions: structuredClone(input.actions),
        actionLabels: structuredClone(input.actionLabels),
        protectedUnchanged: structuredClone(input.protectedUnchanged ?? []),
    };
    const confirmation: PendingAppActionConfirmation = {
        kind: 'app_actions',
        id: input.id,
        prompt: input.prompt,
        assistantMessageId: input.assistantMessageId,
        actions: structuredClone(approvalSnapshot.actions),
        approvalSnapshot,
        executionMode: input.executionMode,
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

    pendingActionConfirmationStore.set({
        confirmations: [...state.confirmations, confirmation].slice(-MAX_CONFIRMATIONS),
    });

    return clonePendingActionConfirmation(confirmation);
}

export function getPendingActionConfirmation(confirmationId: string): PendingAppActionConfirmation | null {
    const confirmation = pendingActionConfirmationStore.value?.confirmations.find(
        (candidate) => candidate.id === confirmationId
    );
    return confirmation ? clonePendingActionConfirmation(confirmation) : null;
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

export function clearPendingActionConfirmations(): void {
    pendingActionConfirmationStore.set({ confirmations: [] });
}
