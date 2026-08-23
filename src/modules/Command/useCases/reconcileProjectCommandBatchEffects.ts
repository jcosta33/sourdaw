import { type ActionHandler, type AppAction, type HandlerAfterCommit } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchPreviewPort } from './commandBatchPreviewPort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { commandRuntimeRepairPort } from './commandRuntimeRepairPort';
import { getCommandHandler } from './getCommandHandler';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';

type PreviewActionHandler = Extract<ActionHandler, { previewExecution: 'isolated-project' }>;

type ReconcileProjectCommandBatchEffectsInput = {
    envelope: VersionedCommandBatchEnvelope;
    serializedReceipt: string;
    shouldReconcile?: () => boolean;
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
    if (receipt.pendingEffects.length === 0) {
        return { status: 'reconciled' };
    }
    if (receipt.pendingEffects.some((effect) => effect.remediation === 'manual-repair')) {
        return { status: 'failed', reason: 'Pending external effect requires manual repair' };
    }
    const pendingCommandIds = new Set(receipt.pendingEffects.map(({ commandId }) => commandId));
    const committedCommandIds = new Set(
        receipt.commandOutcomes.filter(({ outcome }) => outcome === 'committed').map(({ commandId }) => commandId)
    );
    if ([...pendingCommandIds].some((commandId) => !committedCommandIds.has(commandId))) {
        return { status: 'failed', reason: 'Pending external effect does not belong to a committed command' };
    }
    let workspace;
    try {
        workspace = commandBatchPreviewPort.createRecovery(input.envelope.baseRevision);
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
            if (pendingCommandIds.has(command.commandId) && result?.afterAmbiguousCommit) {
                reconciliations.push(result.afterAmbiguousCommit);
            }
        }
    } catch (error) {
        return { status: 'failed', reason: `Idempotency recovery preparation failed: ${failureReason(error)}` };
    } finally {
        workspace.release();
    }

    let requiresCurrentProjectRepair = receipt.pendingEffects.some(
        (effect) => effect.kind === 'runtime-graph' && effect.remediation === 'repair'
    );
    if (!requiresCurrentProjectRepair && reconciliations.length !== receipt.pendingEffects.length) {
        return { status: 'failed', reason: 'Pending external effect cannot be retried exactly' };
    }
    if (!requiresCurrentProjectRepair) {
        let currentWorkspace: ReturnType<typeof commandBatchPreviewPort.create> = null;
        try {
            if (!commandProjectRevisionPort.isConfigured()) {
                requiresCurrentProjectRepair = true;
            } else {
                currentWorkspace = commandBatchPreviewPort.create(commandProjectRevisionPort.capture());
                if (!currentWorkspace) {
                    requiresCurrentProjectRepair = true;
                } else {
                    for (const [actionIndex, action] of actions.entries()) {
                        const command = input.envelope.commands[actionIndex]!;
                        if (!pendingCommandIds.has(command.commandId)) {
                            continue;
                        }
                        const handler = getCommandHandler(action);
                        if (
                            !handler ||
                            handler.executionKind === 'runtime' ||
                            handler.previewExecution !== 'isolated-project'
                        ) {
                            requiresCurrentProjectRepair = true;
                            break;
                        }
                        const before = JSON.stringify(currentWorkspace.getProjectDocument());
                        const result = currentWorkspace.scope(() =>
                            handler.execute(action, {
                                actions,
                                actionIndex,
                                executionMode: 'isolated-preview',
                            })
                        );
                        const after = JSON.stringify(currentWorkspace.getProjectDocument());
                        if (result?.status === 'conflict' || before !== after) {
                            requiresCurrentProjectRepair = true;
                            break;
                        }
                    }
                }
            }
        } catch {
            requiresCurrentProjectRepair = true;
        } finally {
            currentWorkspace?.release();
        }
    }

    try {
        if (requiresCurrentProjectRepair) {
            if (input.shouldReconcile?.() === false) {
                return {
                    status: 'failed',
                    reason: 'Only the authoritative collaboration host can reconcile a durable command batch',
                };
            }
            const repair = commandRuntimeRepairPort.repair();
            if (!repair) {
                return {
                    status: 'failed',
                    reason: 'Current-project runtime repair is unavailable; manual repair is required',
                };
            }
            await repair;
            return { status: 'reconciled' };
        }
        for (const reconcile of reconciliations) {
            if (input.shouldReconcile?.() === false) {
                return {
                    status: 'failed',
                    reason: 'Only the authoritative collaboration host can reconcile a durable command batch',
                };
            }
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
