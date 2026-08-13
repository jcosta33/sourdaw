import { type ActionHandler, type AppAction, type HandlerAfterCommit } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchPreviewPort } from './commandBatchPreviewPort';
import { getCommandHandler } from './getCommandHandler';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';

type PreviewActionHandler = Extract<ActionHandler, { previewExecution: 'isolated-project' }>;

type ReconcileProjectCommandBatchEffectsInput = {
    envelope: VersionedCommandBatchEnvelope;
    serializedReceipt: string;
};

type ReconcileProjectCommandBatchEffectsOutput = { status: 'reconciled' } | { status: 'failed'; reason: string };

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function reconcileProjectCommandBatchEffects(
    input: ReconcileProjectCommandBatchEffectsInput
): Promise<ReconcileProjectCommandBatchEffectsOutput> {
    const receipt = parseStoredVerifiedBatchReceipt({
        baseRevision: input.envelope.baseRevision,
        batchId: input.envelope.batchId,
        commands: input.envelope.commands,
        runId: input.envelope.runId,
        serializedReceipt: input.serializedReceipt,
    });
    if (!receipt) {
        return { status: 'failed', reason: 'Stored project idempotency receipt is invalid' };
    }
    const committedCommandIds = new Set(
        receipt.commandOutcomes.filter(({ outcome }) => outcome === 'committed').map(({ commandId }) => commandId)
    );
    let workspace;
    try {
        workspace = commandBatchPreviewPort.create(input.envelope.baseRevision);
    } catch (error) {
        return { status: 'failed', reason: `Idempotency recovery workspace failed: ${failureReason(error)}` };
    }
    if (!workspace) {
        return { status: 'failed', reason: 'Idempotency recovery workspace is unavailable' };
    }

    const actions = input.envelope.commands.map(
        (command) => ({ type: command.operation, payload: command.arguments }) as AppAction
    );
    const reconciliations: HandlerAfterCommit[] = [];
    try {
        for (const [actionIndex, action] of actions.entries()) {
            const command = input.envelope.commands[actionIndex]!;
            if (!committedCommandIds.has(command.commandId)) {
                continue;
            }
            const handler = getCommandHandler(action);
            if (!handler || handler.executionKind === 'runtime' || handler.previewExecution !== 'isolated-project') {
                return { status: 'failed', reason: `Action cannot be recovered from project truth: ${action.type}` };
            }
            const previewHandler: PreviewActionHandler = handler;
            const result = workspace.scope(() =>
                previewHandler.execute(action, {
                    actions,
                    actionIndex,
                    executionMode: 'isolated-preview',
                })
            );
            if (result?.status === 'conflict' || result?.status === 'no-write') {
                return { status: 'failed', reason: `Action recovery conflicts with its base snapshot: ${action.type}` };
            }
            if (result?.afterCommit) {
                reconciliations.push(result.afterAmbiguousCommit);
            }
        }
    } catch (error) {
        return { status: 'failed', reason: `Idempotency recovery preparation failed: ${failureReason(error)}` };
    } finally {
        workspace.release();
    }

    try {
        for (const reconcile of reconciliations) {
            await reconcile();
        }
    } catch (error) {
        return {
            status: 'failed',
            reason: `Idempotency external-effect reconciliation failed: ${failureReason(error)}`,
        };
    }
    return { status: 'reconciled' };
}
