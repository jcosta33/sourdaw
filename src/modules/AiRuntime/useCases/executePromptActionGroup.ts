import { generateGroupId, isExecutableAppActionType } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { compilePlannedActionCommandBatch } from './compilePlannedActionCommandBatch';
import { describePlannedAction } from './describePlannedAction';
import { executePlannedActions } from './executePlannedActions';
import { getProjectContext } from './getProjectContext';
import { notifyAiChange } from './notifyAiChange';

type ExecutePromptActionGroupInput = {
    actions: readonly AppAction[];
    prompt: string;
    projectRevision: string;
    executionMode?: 'atomic';
    signal?: AbortSignal;
    successVerb?: 'Executed' | 'Confirmed';
};

export async function executePromptActionGroup(input: ExecutePromptActionGroupInput): Promise<void> {
    if (!input.actions.every((action) => isExecutableAppActionType(action.type))) {
        notifyAiChange(
            'Command not executed: one or more actions are not available through the approved command boundary.',
            []
        );
        return;
    }

    const context = getProjectContext();
    const group = generateGroupId(input.prompt);
    const commandBatch = compilePlannedActionCommandBatch({
        actions: input.actions,
        actionLabels: input.actions.map((action) => describePlannedAction({ action, context })),
        autoCommit: true,
        autoCommitApproval: () =>
            captureProjectRevision() === input.projectRevision
                ? { status: 'valid' }
                : { status: 'invalid', reason: 'The command-palette source revision is stale.' },
        context,
        group,
        intent: input.prompt,
        projectRevision: input.projectRevision,
        runId: `prompt-execution-${crypto.randomUUID()}`,
    }).commandBatch;
    const execution = await executePlannedActions({ ...input, group, commandBatch });
    if (execution.status === 'committed' || execution.status === 'executed') {
        return;
    }
    if (execution.status === 'invalidated' || execution.status === 'failed') {
        notifyAiChange(`Command not executed: ${execution.reason}`, []);
        return;
    }
    if (execution.status === 'ambiguous') {
        notifyAiChange(`Command outcome is uncertain: ${execution.reason}. Inspect the project before retrying.`, []);
        return;
    }
    if (execution.status === 'cancelled') {
        notifyAiChange('Command cancelled before it committed. No project changes were applied.', []);
        return;
    }
    notifyAiChange('No project changes were needed.', []);
}
