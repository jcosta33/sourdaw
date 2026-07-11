import {
    describeAction,
    executeAppAction,
    generateGroupId,
    isAppActionCommittedError,
} from '#/modules/Command/useCases';

import { type ChatActionConfirmationStatus } from '../models/Chat';
import { type DsoConfirmationTarget } from '../models/DsoTypes';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import { updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    recordPendingActionExecution,
    type PendingDsoEditConfirmation,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { commitDsoEditPlan } from './dsoEditor/commitDsoEditPlan';
import { getDsoConfirmationTargets } from './dsoEditor/getDsoConfirmationTargets';
import { notifyAiChange } from './notifyAiChange';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'executed' }
    | { status: 'failed'; reason: string };

type ConfirmPendingChatActionsOutput = Promise<ConfirmPendingChatActionsResult>;

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'accepted' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'accepted',
        content: `Confirming:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    if (confirmation.kind === 'dso_edit') {
        return confirmPendingDsoEdit(confirmation);
    }

    const group = generateGroupId(confirmation.prompt);
    const executedLabels: Array<{ actionType: string; label: string }> = [];
    let action_history_failed_after_commit = false;

    try {
        for (const action of confirmation.actions) {
            try {
                await executeAppAction(action, { ...group, source: 'prompt' });
            } catch (error) {
                if (!isAppActionCommittedError(error)) {
                    throw error;
                }
                action_history_failed_after_commit = true;
            }
            const execution = { actionType: action.type, label: describeAction(action) };
            executedLabels.push(execution);
            recordPendingActionExecution({ confirmationId: confirmation.id, execution });
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content: `Failed to execute confirmed actions:\n\n${reason}`,
        });
        return { status: 'failed', reason };
    }

    const historyGroup: AiActionGroup = {
        id: group.groupId,
        prompt: confirmation.prompt,
        actions: executedLabels.map((entry) => ({
            kind: 'appAction',
            actionType: entry.actionType,
            label: entry.label,
        })),
        groupId: group.groupId,
        timestamp: Date.now(),
        reverted: false,
    };
    pushAiActionGroup(historyGroup);

    notifyAiChange(
        `Confirmed: ${confirmation.prompt}`,
        confirmation.actions.map((action) => action.type)
    );

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        content: action_history_failed_after_commit
            ? `Applied after confirmation:\n\n${executedLabels.map((entry) => `- **${entry.actionType}**: ${entry.label}`).join('\n')}\n\nAction history failed after the change was applied. Do not retry these confirmed actions.`
            : `Executed after confirmation:\n\n${executedLabels.map((entry) => `- **${entry.actionType}**: ${entry.label}`).join('\n')}`,
    });

    return { status: 'executed' };
}

async function confirmPendingDsoEdit(confirmation: PendingDsoEditConfirmation): ConfirmPendingChatActionsOutput {
    const targetMismatchReason = getDsoConfirmationTargetMismatch(confirmation);
    if (targetMismatchReason) {
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: targetMismatchReason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: targetMismatchReason,
            content: `Project state changed before this destructive edit was confirmed:\n\n${targetMismatchReason}`,
        });
        return { status: 'failed', reason: targetMismatchReason };
    }

    let result: Awaited<ReturnType<typeof commitDsoEditPlan>>;
    try {
        result = await commitDsoEditPlan({
            plan: confirmation.plan,
            userRequest: confirmation.prompt,
            assistantMessageId: confirmation.assistantMessageId,
            reasoning: confirmation.reasoning,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content: `Failed to execute confirmed DSO edit:\n\n${reason}`,
        });
        return { status: 'failed', reason };
    }

    for (const summary of result.summaries) {
        recordPendingActionExecution({
            confirmationId: confirmation.id,
            execution: { actionType: 'dsoEdit', label: summary },
        });
    }

    if (result.failures.length > 0) {
        const reason = result.failures.map((failure) => `${failure.op} (${failure.reason})`).join('; ');
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
        });
        return { status: 'failed', reason };
    }

    notifyAiChange(`Confirmed: ${confirmation.prompt}`, ['dsoEdit']);

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
    });

    return { status: 'executed' };
}

function getDsoConfirmationTargetMismatch(confirmation: PendingDsoEditConfirmation): string | null {
    const currentTargets = getDsoConfirmationTargets({ dsos: confirmation.plan.dsos }).confirmationTargets;
    if (currentTargets.length !== confirmation.confirmationTargets.length) {
        return 'The destructive edit targets no longer match the pending confirmation.';
    }

    for (let index = 0; index < confirmation.confirmationTargets.length; index++) {
        const expectedTarget = confirmation.confirmationTargets[index];
        const currentTarget = currentTargets[index];
        if (!expectedTarget || !currentTarget) {
            return 'The destructive edit targets no longer match the pending confirmation.';
        }
        if (expectedTarget.op !== currentTarget.op) {
            return `The destructive edit target changed: ${expectedTarget.label}`;
        }
        if (!dsoConfirmationFingerprintsMatch({ expectedTarget, currentTarget })) {
            return `The destructive edit target changed: ${expectedTarget.label}`;
        }
    }

    return null;
}

function dsoConfirmationFingerprintsMatch(input: {
    expectedTarget: DsoConfirmationTarget;
    currentTarget: DsoConfirmationTarget;
}): boolean {
    const expected = input.expectedTarget.fingerprint;
    const current = input.currentTarget.fingerprint;
    if (expected.kind !== current.kind) {
        return false;
    }

    switch (expected.kind) {
        case 'track':
            return (
                current.kind === 'track' &&
                current.trackId === expected.trackId &&
                current.trackName === expected.trackName
            );
        case 'clip':
            return (
                current.kind === 'clip' &&
                current.clipId === expected.clipId &&
                current.clipName === expected.clipName &&
                current.trackId === expected.trackId &&
                current.trackName === expected.trackName
            );
        case 'device':
            return (
                current.kind === 'device' &&
                current.deviceId === expected.deviceId &&
                current.deviceName === expected.deviceName &&
                current.trackId === expected.trackId &&
                current.trackName === expected.trackName
            );
    }

    return false;
}
