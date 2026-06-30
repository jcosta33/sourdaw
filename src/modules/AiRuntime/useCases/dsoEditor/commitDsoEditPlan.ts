import { commitActionUndoEntry, generateGroupId } from '#/modules/Command/useCases';
import { transactSnapshot } from '#/modules/CrdtDocument/useCases';

import { type EditPlan } from '../../models/DsoTypes';
import { pushAiActionGroup } from '../../stores/aiActionHistoryStore';
import { updateChatMessage } from '../../stores/chatStore';

import { executeDsos, type DsoExecutionResult, validateDsos } from './compileDso';
import { logEdit } from './serializeLogicalState';

type CommitDsoEditPlanInput = {
    plan: EditPlan;
    userRequest: string;
    assistantMessageId: string;
    reasoning: string | undefined;
};

type CommitDsoEditPlanOutput = Promise<DsoExecutionResult>;

export async function commitDsoEditPlan(input: CommitDsoEditPlanInput): CommitDsoEditPlanOutput {
    const validationErrors = validateDsos(input.plan.dsos);
    if (validationErrors.length > 0) {
        const failures = validationErrors.map((event) => ({ op: event.dso.op, reason: event.reason }));
        const errorText = failures.map((failure) => `${failure.op} (${failure.reason})`).join('; ');
        updateChatMessage(input.assistantMessageId, {
            content: `Edit rejected — ${errorText}`,
            isStreaming: false,
            reasoning: input.reasoning,
            error: errorText,
        });
        return { summaries: [], failures };
    }

    let summaries: string[] = [];
    let failures: DsoExecutionResult['failures'] = [];
    const { before: bundleBefore, after: bundleAfter } = await transactSnapshot(async () => {
        const result = await executeDsos(input.plan.dsos);
        summaries = result.summaries;
        failures = result.failures;
    });

    const { groupId, groupLabel } = generateGroupId(input.userRequest);
    commitActionUndoEntry({
        label: `AI: ${input.plan.intent}`,
        action: { type: 'restoreDsoSnapshot', payload: { bundle: bundleAfter } },
        inverseAction: { type: 'restoreDsoSnapshot', payload: { bundle: bundleBefore } },
        source: 'ai',
        groupId,
        groupLabel,
    });

    pushAiActionGroup({
        id: `dso-edit-${Date.now()}`,
        prompt: input.userRequest,
        actions: summaries.map((state) => ({ kind: 'jsonEdit' as const, label: state })),
        groupId,
        timestamp: Date.now(),
        reverted: false,
    });

    for (const state of summaries) {
        logEdit(state);
    }

    const failureText = formatFailures(failures);
    const appliedText = summaries.length > 0 ? `Done! ${summaries.join('. ')}.` : 'No changes were applied.';
    updateChatMessage(input.assistantMessageId, {
        content: `${appliedText}${failureText}`,
        isStreaming: false,
        reasoning: input.reasoning,
        isDsoAction: failures.length === 0 ? true : undefined,
        error: failures.length > 0 ? failureText.trim() : undefined,
    });

    return { summaries, failures };
}

function formatFailures(failures: DsoExecutionResult['failures']): string {
    if (failures.length === 0) {
        return '';
    }
    return (
        ` However, ${failures.length} operation${failures.length === 1 ? '' : 's'} failed: ` +
        `${failures.map((failure) => `${failure.op} (${failure.reason})`).join('; ')}.`
    );
}
