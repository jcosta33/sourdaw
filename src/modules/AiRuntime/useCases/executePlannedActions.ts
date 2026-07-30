import { logger } from '#/infra/logger/appLogger';
import { executeAppActionBatch, generateGroupId } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';

import { notifyAiChange } from './notifyAiChange';
import { recordAiActionGroup } from './recordAiActionGroup';

type ExecutePlannedActionsInput = {
    prompt: string;
    actions: readonly AppAction[];
    projectRevision: string;
    executionMode?: 'atomic';
    signal?: AbortSignal;
    successVerb?: 'Executed' | 'Confirmed';
};

type ExecutedAction = {
    actionType: AppAction['type'];
    label: string;
};

type ExecutePlannedActionsResult =
    | {
          status: 'committed';
          actions: ExecutedAction[];
          commitWarning?: string;
          reportingWarning?: string;
      }
    | { status: 'no-op' }
    | { status: 'cancelled' }
    | { status: 'invalidated'; reason: string }
    | { status: 'ambiguous' | 'failed'; reason: string };

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function executePlannedActions(input: ExecutePlannedActionsInput): Promise<ExecutePlannedActionsResult> {
    const group = generateGroupId(input.prompt);
    let revisionInvalidated = false;

    function shouldExecute(): boolean {
        revisionInvalidated = captureProjectRevision() !== input.projectRevision;
        return input.signal?.aborted !== true && !revisionInvalidated;
    }

    const batchResult = await executeAppActionBatch(input.actions, {
        ...group,
        source: 'prompt',
        requireCompensation: input.executionMode === 'atomic',
        shouldExecute,
    });

    if (batchResult.status === 'cancelled') {
        if (input.signal?.aborted === true) {
            return { status: 'cancelled' };
        }
        revisionInvalidated = captureProjectRevision() !== input.projectRevision;
        if (revisionInvalidated) {
            return { status: 'invalidated', reason: new AiProposalInvalidatedError().message };
        }
        return { status: 'cancelled' };
    }

    if (batchResult.status === 'no-op') {
        return { status: 'no-op' };
    }

    if (batchResult.status === 'ambiguous') {
        return { status: 'ambiguous', reason: batchResult.reason };
    }

    if (batchResult.status !== 'committed' && batchResult.status !== 'committed-with-warning') {
        return { status: 'failed', reason: batchResult.reason };
    }

    const actions = batchResult.actions.map(({ action, label }) => ({ actionType: action.type, label }));
    const commitWarning = batchResult.status === 'committed-with-warning' ? batchResult.warning : undefined;
    const reportingFailures: string[] = [];

    try {
        recordAiActionGroup({
            prompt: input.prompt,
            groupId: group.groupId,
            actions: actions.map((entry) => ({
                kind: 'appAction',
                actionType: entry.actionType,
                label: entry.label,
            })),
        });
    } catch (error) {
        reportingFailures.push(`history: ${failureReason(error)}`);
        logger.error(new Error('AI post-commit history reporting failed', { cause: error }));
    }

    try {
        const successSummary = commitWarning
            ? `${input.successVerb ?? 'Executed'}: ${input.prompt}. Committed with follow-up warning: ${commitWarning}`
            : `${input.successVerb ?? 'Executed'}: ${input.prompt}`;
        notifyAiChange(
            successSummary,
            actions.map((entry) => entry.actionType)
        );
    } catch (error) {
        reportingFailures.push(`notification: ${failureReason(error)}`);
        logger.error(new Error('AI post-commit notification failed', { cause: error }));
    }

    const reportingWarning = reportingFailures.length > 0 ? reportingFailures.join('; ') : undefined;
    return {
        status: 'committed',
        actions,
        ...(commitWarning ? { commitWarning } : {}),
        ...(reportingWarning ? { reportingWarning } : {}),
    };
}
