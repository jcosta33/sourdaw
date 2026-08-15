import { logger } from '#/infra/logger/appLogger';
import {
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    type createVerifiedBatchReceipt,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';

import { getVerifiedBatchReplayDisposition } from './getVerifiedBatchReplayDisposition';
import { notifyAiChange } from './notifyAiChange';
import { recordAiActionGroup } from './recordAiActionGroup';

type CommandBatchInput =
    | {
          commandBatch: Pick<
              Parameters<typeof executeVersionedCommandBatchEnvelope>[0],
              'approvalBinding' | 'authority' | 'serialized'
          >;
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

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;

type ExecutePlannedActionsResult =
    | {
          status: 'committed';
          actions: ExecutedAction[];
          commitWarning?: string;
          receipt?: VerifiedBatchReceipt;
          reportingWarning?: string;
      }
    | {
          status: 'executed';
          actions: ExecutedAction[];
          executionWarning?: string;
          receipt?: VerifiedBatchReceipt;
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
    if (input.legacyExecution) {
        return { status: 'failed', reason: 'Legacy planned-action execution is not authorized' };
    }

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
        signal: input.signal,
    };
    const batchResult = await executeVersionedCommandBatchEnvelope({
        ...input.commandBatch,
        options: executionOptions,
    });

    if (batchResult.status === 'previewed') {
        batchResult.resource.release();
        return { status: 'failed', reason: 'A planned action batch cannot execute in preview mode' };
    }

    if (batchResult.status === 'idempotent-replay') {
        const replay = getVerifiedBatchReplayDisposition(batchResult.receipt);
        if (replay.status === 'committed') {
            return {
                status: 'committed',
                actions: [],
                ...(replay.warning ? { commitWarning: replay.warning } : {}),
                receipt: batchResult.receipt,
            };
        }
        if (replay.status === 'executed') {
            return {
                status: 'executed',
                actions: [],
                ...(replay.warning ? { executionWarning: replay.warning } : {}),
                receipt: batchResult.receipt,
            };
        }
        return replay;
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
    if (!('receipt' in batchResult)) {
        return { status: 'failed', reason: 'Versioned command execution did not return a verified receipt' };
    }

    const actions = batchResult.actions.map(({ action, label }) => ({ actionType: action.type, label }));
    const receipt = batchResult.receipt;
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
            receipt,
            ...(reportingWarning ? { reportingWarning } : {}),
        };
    }
    return {
        status: 'committed',
        actions,
        ...(commitWarning ? { commitWarning } : {}),
        receipt,
        ...(reportingWarning ? { reportingWarning } : {}),
    };
}
