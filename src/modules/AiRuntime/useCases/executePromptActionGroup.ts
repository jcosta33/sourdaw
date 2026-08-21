import { generateGroupId, isExecutableAppActionType } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { agentRunLifecycle } from './agentRunLifecycle';
import { executePlannedActions } from './executePlannedActions';
import { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
import { notifyAiChange } from './notifyAiChange';
import { recordAgentRunReceiptSaga } from './recordAgentRunReceiptSaga';

type ExecutePromptActionGroupInput = {
    actions: readonly AppAction[];
    prompt: string;
    projectRevision: string;
    executionMode?: 'atomic';
    signal?: AbortSignal;
    successVerb?: 'Executed' | 'Confirmed';
    runId: string;
    prepared: {
        commandBatch: Parameters<typeof issueAgentCommandApprovalBinding>[0]['commandBatch'];
        agentApproval: Parameters<typeof issueAgentCommandApprovalBinding>[0]['approval'] | null;
        requiresConfirmation: boolean;
    };
};

export async function executePromptActionGroup(input: ExecutePromptActionGroupInput): Promise<void> {
    if (!input.actions.every((action) => isExecutableAppActionType(action.type))) {
        notifyAiChange(
            'Command not executed: one or more actions are not available through the approved command boundary.',
            []
        );
        return;
    }

    const group = generateGroupId(input.prompt);
    const commandBatch = (() => {
        if (!input.prepared.agentApproval) {
            return input.prepared.commandBatch;
        }
        return {
            ...input.prepared.commandBatch,
            approvalBinding: issueAgentCommandApprovalBinding({
                approval: input.prepared.agentApproval,
                commandBatch: input.prepared.commandBatch,
            }),
        };
    })();
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'executing', revision: input.projectRevision });
    const execution = await executePlannedActions({ ...input, group, commandBatch });
    if (execution.status === 'committed' || execution.status === 'executed') {
        if (execution.receipt) {
            recordAgentRunReceiptSaga({ runId: input.runId, receipt: execution.receipt, actions: input.actions });
        }
        agentRunLifecycle.transitionPhase({
            runId: input.runId,
            phase: 'completed',
            revision: captureProjectRevision(),
        });
        return;
    }
    if (execution.status === 'invalidated' || execution.status === 'failed') {
        agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'failed' });
        notifyAiChange(`Command not executed: ${execution.reason}`, []);
        return;
    }
    if (execution.status === 'ambiguous') {
        agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'partially-completed' });
        notifyAiChange(`Command outcome is uncertain: ${execution.reason}. Inspect the project before retrying.`, []);
        return;
    }
    if (execution.status === 'cancelled') {
        agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'cancelled' });
        notifyAiChange('Command cancelled before it committed. No project changes were applied.', []);
        return;
    }
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'completed' });
    notifyAiChange('No project changes were needed.', []);
}
