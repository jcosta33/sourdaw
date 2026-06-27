import { createStore } from '#/infra/store/createStore';

import { type ChatActionConfirmationStatus } from '../models/Chat';
import { type RuntimeAction } from '../models/RuntimeAction';

export type PendingActionExecution = {
    actionType: string;
    label: string;
};

export type PendingActionConfirmation = {
    id: string;
    prompt: string;
    assistantMessageId: string;
    actions: RuntimeAction[];
    actionLabels: string[];
    executedActions: PendingActionExecution[];
    status: ChatActionConfirmationStatus;
    error: string | null;
    createdAt: number;
    resolvedAt: number | null;
};

export type PendingActionConfirmationState = {
    confirmations: PendingActionConfirmation[];
};

export const pendingActionConfirmationStore = createStore<PendingActionConfirmationState>({
    initialData: { confirmations: [] },
});

const MAX_CONFIRMATIONS = 20;

type ProposePendingActionConfirmationInput = {
    id: string;
    prompt: string;
    assistantMessageId: string;
    actions: RuntimeAction[];
    actionLabels: string[];
};

export function proposePendingActionConfirmation(
    input: ProposePendingActionConfirmationInput
): PendingActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }

    const confirmation: PendingActionConfirmation = {
        id: input.id,
        prompt: input.prompt,
        assistantMessageId: input.assistantMessageId,
        actions: [...input.actions],
        actionLabels: [...input.actionLabels],
        executedActions: [],
        status: 'proposed',
        error: null,
        createdAt: Date.now(),
        resolvedAt: null,
    };

    pendingActionConfirmationStore.set({
        confirmations: [...state.confirmations, confirmation].slice(-MAX_CONFIRMATIONS),
    });

    return confirmation;
}

export function getPendingActionConfirmation(confirmationId: string): PendingActionConfirmation | null {
    return (
        pendingActionConfirmationStore.value?.confirmations.find(
            (confirmation) => confirmation.id === confirmationId
        ) ?? null
    );
}

type RecordPendingActionExecutionInput = {
    confirmationId: string;
    execution: PendingActionExecution;
};

export function recordPendingActionExecution(
    input: RecordPendingActionExecutionInput
): PendingActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }

    let updated: PendingActionConfirmation | null = null;
    const confirmations = state.confirmations.map((confirmation) => {
        if (confirmation.id !== input.confirmationId) {
            return confirmation;
        }

        updated = {
            ...confirmation,
            executedActions: [...confirmation.executedActions, input.execution],
        };
        return updated;
    });

    if (!updated) {
        return null;
    }

    pendingActionConfirmationStore.set({ confirmations });
    return updated;
}

type UpdatePendingActionConfirmationStatusInput = {
    confirmationId: string;
    status: ChatActionConfirmationStatus;
    error?: string;
};

export function updatePendingActionConfirmationStatus(
    input: UpdatePendingActionConfirmationStatusInput
): PendingActionConfirmation | null {
    const state = pendingActionConfirmationStore.value;
    if (!state) {
        return null;
    }

    let updated: PendingActionConfirmation | null = null;
    const confirmations = state.confirmations.map((confirmation) => {
        if (confirmation.id !== input.confirmationId) {
            return confirmation;
        }

        updated = {
            ...confirmation,
            status: input.status,
            error: input.error ?? null,
            resolvedAt: input.status === 'proposed' || input.status === 'accepted' ? null : Date.now(),
        };
        return updated;
    });

    if (!updated) {
        return null;
    }

    pendingActionConfirmationStore.set({ confirmations });
    return updated;
}

export function clearPendingActionConfirmations(): void {
    pendingActionConfirmationStore.set({ confirmations: [] });
}
