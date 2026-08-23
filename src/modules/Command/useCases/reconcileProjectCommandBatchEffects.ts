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

function pendingEffectCannotRetryReason(effectKind: 'external-effect' | 'runtime-graph'): string {
    return effectKind === 'external-effect'
        ? 'Pending external effect cannot be retried exactly'
        : 'Pending runtime effect cannot be retried exactly';
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
    const pendingEffectByCommandId = new Map(receipt.pendingEffects.map((effect) => [effect.commandId, effect]));
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
    const exactReconciliations = new Map<string, HandlerAfterCommit>();
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
            const pendingEffect = pendingEffectByCommandId.get(command.commandId);
            if (
                pendingEffect &&
                !(pendingEffect.kind === 'runtime-graph' && pendingEffect.remediation === 'repair') &&
                result?.afterAmbiguousCommit
            ) {
                exactReconciliations.set(command.commandId, result.afterAmbiguousCommit);
            }
        }
    } catch (error) {
        return { status: 'failed', reason: `Idempotency recovery preparation failed: ${failureReason(error)}` };
    } finally {
        workspace.release();
    }

    const runtimeRepairCommandIds = new Set(
        receipt.pendingEffects.flatMap((effect) =>
            effect.kind === 'runtime-graph' && effect.remediation === 'repair' ? [effect.commandId] : []
        )
    );

    for (const effect of receipt.pendingEffects) {
        if (runtimeRepairCommandIds.has(effect.commandId)) {
            continue;
        }
        if (!exactReconciliations.has(effect.commandId)) {
            return { status: 'failed', reason: pendingEffectCannotRetryReason(effect.kind) };
        }
    }

    let currentWorkspace: ReturnType<typeof commandBatchPreviewPort.create> = null;
    try {
        const exactRetryEffects = receipt.pendingEffects.filter(
            (effect) => !runtimeRepairCommandIds.has(effect.commandId)
        );
        if (exactRetryEffects.length > 0) {
            if (!commandProjectRevisionPort.isConfigured()) {
                for (const effect of exactRetryEffects) {
                    if (effect.kind !== 'runtime-graph') {
                        return { status: 'failed', reason: pendingEffectCannotRetryReason(effect.kind) };
                    }
                    runtimeRepairCommandIds.add(effect.commandId);
                }
            } else {
                currentWorkspace = commandBatchPreviewPort.create(commandProjectRevisionPort.capture());
                if (!currentWorkspace) {
                    for (const effect of exactRetryEffects) {
                        if (effect.kind !== 'runtime-graph') {
                            return { status: 'failed', reason: pendingEffectCannotRetryReason(effect.kind) };
                        }
                        runtimeRepairCommandIds.add(effect.commandId);
                    }
                } else {
                    for (const [actionIndex, action] of actions.entries()) {
                        const command = input.envelope.commands[actionIndex]!;
                        const pendingEffect = pendingEffectByCommandId.get(command.commandId);
                        if (!pendingEffect || runtimeRepairCommandIds.has(command.commandId)) {
                            continue;
                        }
                        const handler = getCommandHandler(action);
                        if (
                            !handler ||
                            handler.executionKind === 'runtime' ||
                            handler.previewExecution !== 'isolated-project'
                        ) {
                            if (pendingEffect.kind !== 'runtime-graph') {
                                return {
                                    status: 'failed',
                                    reason: pendingEffectCannotRetryReason(pendingEffect.kind),
                                };
                            }
                            runtimeRepairCommandIds.add(command.commandId);
                            continue;
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
                            if (pendingEffect.kind !== 'runtime-graph') {
                                return {
                                    status: 'failed',
                                    reason: pendingEffectCannotRetryReason(pendingEffect.kind),
                                };
                            }
                            runtimeRepairCommandIds.add(command.commandId);
                        }
                    }
                }
            }
        }
    } catch {
        for (const effect of receipt.pendingEffects) {
            if (runtimeRepairCommandIds.has(effect.commandId)) {
                continue;
            }
            if (effect.kind !== 'runtime-graph') {
                return { status: 'failed', reason: pendingEffectCannotRetryReason(effect.kind) };
            }
            runtimeRepairCommandIds.add(effect.commandId);
        }
    } finally {
        currentWorkspace?.release();
    }

    try {
        if (runtimeRepairCommandIds.size > 0) {
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
        }
        for (const effect of receipt.pendingEffects) {
            if (runtimeRepairCommandIds.has(effect.commandId)) {
                continue;
            }
            const reconcile = exactReconciliations.get(effect.commandId);
            if (!reconcile) {
                return { status: 'failed', reason: pendingEffectCannotRetryReason(effect.kind) };
            }
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
