import { logger } from '#/infra/logger/appLogger';
import {
    executeAppActionBatch,
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';

import { notifyAiChange } from './notifyAiChange';
import { recordAiActionGroup } from './recordAiActionGroup';

type CommandBatchInput =
    | {
          commandBatch: Pick<Parameters<typeof executeVersionedCommandBatchEnvelope>[0], 'authority' | 'serialized'>;
          legacyExecution?: never;
      }
    | {
          commandBatch?: never;
          legacyExecution: true;
      };

type ExecutePlannedActionsInput = CommandBatchInput & {
    prompt: string;
    actions: readonly AppAction[];
    projectRevision: string;
    executionMode?: 'atomic';
    signal?: AbortSignal;
    successVerb?: 'Executed' | 'Confirmed';
    group?: ReturnType<typeof generateGroupId>;
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
    | {
          status: 'executed';
          actions: ExecutedAction[];
          executionWarning?: string;
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
    const group = input.group ?? generateGroupId(input.prompt);
    let revisionInvalidated = false;

    function shouldExecute(): boolean {
        revisionInvalidated = captureProjectRevision() !== input.projectRevision;
        return input.signal?.aborted !== true && !revisionInvalidated;
    }

    const executionOptions = {
        ...group,
        source: 'prompt' as const,
        requireCompensation: input.executionMode === 'atomic',
        shouldExecute,
    };
    const batchResult = input.commandBatch
        ? await executeVersionedCommandBatchEnvelope({ ...input.commandBatch, options: executionOptions })
        : await executeAppActionBatch(input.actions, executionOptions);

    if (batchResult.status === 'previewed') {
        batchResult.resource.release();
        return { status: 'failed', reason: 'A planned action batch cannot execute in preview mode' };
    }

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

    const isCommitted = batchResult.status === 'committed' || batchResult.status === 'committed-with-warning';
    const isExecuted = batchResult.status === 'executed' || batchResult.status === 'executed-with-warning';
    if (!isCommitted && !isExecuted) {
        return { status: 'failed', reason: batchResult.reason };
    }

    const actions = batchResult.actions.map(({ action, label }) => ({ actionType: action.type, label }));
    const commitWarning = batchResult.status === 'committed-with-warning' ? batchResult.warning : undefined;
    const executionWarning = batchResult.status === 'executed-with-warning' ? batchResult.warning : undefined;
    const reportingFailures: string[] = [];

    try {
        recordAiActionGroup({
            prompt: input.prompt,
            groupId: group.groupId,
            executionKind: isExecuted ? 'runtime' : 'project',
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
        let successSummary = `${input.successVerb ?? 'Executed'}: ${input.prompt}`;
        if (commitWarning) {
            successSummary = `${successSummary}. Committed with follow-up warning: ${commitWarning}`;
        }
        if (executionWarning) {
            successSummary = `${successSummary}. Executed with follow-up warning: ${executionWarning}`;
        }
        notifyAiChange(
            successSummary,
            actions.map((entry) => entry.actionType)
        );
    } catch (error) {
        reportingFailures.push(`notification: ${failureReason(error)}`);
        logger.error(new Error('AI post-commit notification failed', { cause: error }));
    }

    const reportingWarning = reportingFailures.length > 0 ? reportingFailures.join('; ') : undefined;
    if (isExecuted) {
        return {
            status: 'executed',
            actions,
            ...(executionWarning ? { executionWarning } : {}),
            ...(reportingWarning ? { reportingWarning } : {}),
        };
    }
    return {
        status: 'committed',
        actions,
        ...(commitWarning ? { commitWarning } : {}),
        ...(reportingWarning ? { reportingWarning } : {}),
    };
}
