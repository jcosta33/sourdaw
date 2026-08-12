import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import {
    AutomergeStorageTransactionCommittedError,
    runWithAutomergeStorageTransaction,
    waitForAutomergeSnapshotTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearSemanticContext, setSemanticContext } from '#/modules/CrdtDocument/stores';
import {
    type ActionHandler,
    type AppAction,
    type ExecuteOptions,
    type HandlerAfterCommit,
    type HandlerDescribeResult,
    type HandlerExecutionResult,
} from '#/utils/handlerContract';

import { AppActionConflictError } from '../errors/AppActionExecutionError';
import { type VersionedCommandEnvelope, type VersionedCommandReceipt } from '../models/VersionedCommandEnvelope';
import { registerActionReplayCapability, revokeActionReplayCapability } from '../stores/actionReplayCapabilities';
import { getHandler } from '../stores/handlerRegistry';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { commitUndoEntry } from './commitUndoEntry';
import { createExecutionCommandEnvelope } from './createExecutionCommandEnvelope';
import { createUndoEntry } from './createUndoEntry';
import { createVersionedCommandReceipt } from './createVersionedCommandReceipt';
import { findSingletonBatchAction } from './findSingletonBatchAction';
import { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';
import { recordAction } from './macro/recording/recordAction';
import { productionBriefAdmissionPort } from './productionBriefAdmissionPort';
import { traceAppAction } from './traceAppAction';

type ExecutedBatchAction = {
    action: AppAction;
    label: string;
    receipt?: VersionedCommandReceipt;
};

type ExecuteAppActionBatchResult =
    | { status: 'committed'; actions: ExecutedBatchAction[] }
    | { status: 'committed-with-warning'; actions: ExecutedBatchAction[]; warning: string }
    | { status: 'executed'; actions: ExecutedBatchAction[] }
    | { status: 'executed-with-warning'; actions: ExecutedBatchAction[]; warning: string }
    | { status: 'no-op'; actions: [] }
    | { status: 'ambiguous'; reason: string; actions: [] }
    | { status: 'rejected' | 'conflicted' | 'cancelled' | 'failed'; reason: string; actions: [] };

type ExecuteAppActionBatchOptions = ExecuteOptions & {
    commandEnvelopes?: readonly VersionedCommandEnvelope[];
    requireCompensation?: boolean;
    onCommitted?: (actions: readonly AppAction[]) => void;
};

type ExecuteAppActionBatch = (
    actions: readonly AppAction[],
    options?: ExecuteAppActionBatchOptions
) => Promise<ExecuteAppActionBatchResult>;

type PreparedBatchAction = {
    action: AppAction;
    afterAbort: HandlerAfterCommit | null;
    afterCommit: HandlerAfterCommit | null;
    afterAmbiguousCommit: HandlerAfterCommit | null;
    requiresAbortCompensation: boolean;
    handler: ActionHandler;
    description: HandlerDescribeResult | null;
    envelope: VersionedCommandEnvelope;
    label: string;
};

type AutomergeStorageTransactionScope = <Result>(callback: () => Result) => Result;

class AppActionBatchCancelledError extends Error {
    constructor() {
        super('Batch execution authority was revoked');
        this.name = 'AppActionBatchCancelledError';
    }
}

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createExecutedBatchAction(prepared: PreparedBatchAction): ExecutedBatchAction {
    return {
        action: prepared.action,
        label: prepared.label,
        receipt: createVersionedCommandReceipt({
            envelope: prepared.envelope,
        }),
    };
}

function assertExecutionAuthorized(shouldExecute: ExecuteOptions['shouldExecute'] | undefined): void {
    if (shouldExecute && !shouldExecute()) {
        throw new AppActionBatchCancelledError();
    }
}

function clearBatchSemanticContext(): string | null {
    try {
        clearSemanticContext();
        return null;
    } catch (error) {
        return failureReason(error);
    }
}

async function executeRuntimeAction(
    prepared: PreparedBatchAction,
    source: ExecuteOptions['source'] | undefined,
    shouldExecute: ExecuteOptions['shouldExecute'] | undefined
): Promise<ExecuteAppActionBatchResult> {
    try {
        assertExecutionAuthorized(shouldExecute);
        if (prepared.handler.isNoop?.(prepared.action)) {
            return { status: 'no-op', actions: [] };
        }
        traceAppAction(prepared.action.type, source ?? 'manual');
        const result: HandlerExecutionResult | void = await prepared.handler.execute(prepared.action);
        if (result?.status === 'no-write') {
            return { status: 'no-op', actions: [] };
        }
        if (result?.status === 'conflict') {
            return {
                status: 'conflicted',
                reason: `Action conflicts with current project state: ${prepared.action.type}`,
                actions: [],
            };
        }

        const actions = [createExecutedBatchAction(prepared)];
        if (!result?.afterRuntimeExecution) {
            return { status: 'executed', actions };
        }

        try {
            await result.afterRuntimeExecution();
            return { status: 'executed', actions };
        } catch (effectError) {
            return {
                status: 'executed-with-warning',
                actions,
                warning: `${prepared.action.type} follow-up effect failed: ${failureReason(effectError)}`,
            };
        }
    } catch (error) {
        if (error instanceof AppActionBatchCancelledError) {
            return { status: 'cancelled', reason: error.message, actions: [] };
        }
        logger.error(new Error('Runtime action handler failed', { cause: error }));
        return { status: 'failed', reason: failureReason(error), actions: [] };
    }
}

async function reconcileAmbiguousRuntime(actions: readonly PreparedBatchAction[]): Promise<string | null> {
    const failures: string[] = [];
    for (const action of actions) {
        if (!action.afterAmbiguousCommit) {
            continue;
        }
        try {
            await action.afterAmbiguousCommit();
        } catch (error) {
            failures.push(`${action.action.type}: ${failureReason(error)}`);
        }
    }
    return failures.length > 0 ? `runtime reconciliation failed: ${failures.join('; ')}` : null;
}

async function executePreparedBatch(
    preparedActions: readonly PreparedBatchAction[],
    scope: AutomergeStorageTransactionScope,
    attemptedActions: PreparedBatchAction[],
    shouldExecute: ExecuteOptions['shouldExecute'] | undefined
): Promise<PreparedBatchAction[]> {
    const executedActions: PreparedBatchAction[] = [];
    for (const prepared of preparedActions) {
        assertExecutionAuthorized(shouldExecute);
        if (prepared.handler.isNoop?.(prepared.action)) {
            continue;
        }
        prepared.afterAbort = prepared.handler.prepareAbort?.(prepared.action) ?? null;
        attemptedActions.push(prepared);
        const result: HandlerExecutionResult | void = await scope(() => prepared.handler.execute(prepared.action));
        if (result?.status === 'no-write' || result?.status === 'conflict') {
            attemptedActions.pop();
            throw new AppActionConflictError(prepared.action.type);
        }
        prepared.afterCommit = result?.afterCommit ?? null;
        prepared.afterAmbiguousCommit = result?.afterAmbiguousCommit ?? null;
        executedActions.push(prepared);
    }
    assertExecutionAuthorized(shouldExecute);
    return executedActions;
}

async function rollbackAttemptedBatch(
    attemptedActions: readonly PreparedBatchAction[],
    scope: AutomergeStorageTransactionScope
): Promise<string | null> {
    const failures: string[] = [];
    for (const prepared of [...attemptedActions].reverse()) {
        const rollback = prepared.afterAbort;
        if (!rollback) {
            continue;
        }
        try {
            await scope(rollback);
        } catch (error) {
            failures.push(`${prepared.action.type}: ${failureReason(error)}`);
        }
    }
    return failures.length > 0 ? failures.join('; ') : null;
}

function appendAbortFailures(
    reason: string,
    compensationFailure: string | null,
    rollbackFailure: string | null
): string {
    let result = reason;
    if (compensationFailure) {
        result = `${result}; runtime compensation failed: ${compensationFailure}`;
    }
    if (rollbackFailure) {
        result = `${result}; abort rollback failed: ${rollbackFailure}`;
    }
    return result;
}

async function compensateAttemptedBatch(
    attemptedActions: readonly PreparedBatchAction[],
    scope: AutomergeStorageTransactionScope
): Promise<string | null> {
    const compensableActions = attemptedActions.filter((action) => action.requiresAbortCompensation);
    if (compensableActions.length === 0) {
        return null;
    }

    try {
        for (const prepared of [...compensableActions].reverse()) {
            const inverseAction = prepared.description?.inverseAction;
            if (!inverseAction) {
                throw new Error(`No inverse action available for ${prepared.action.type}`);
            }
            const inverseHandler = getHandler(inverseAction);
            if (!inverseHandler) {
                throw new Error(`No registered handler for inverse action: ${inverseAction.type}`);
            }
            const compensation = createExecutionCommandEnvelope({
                action: inverseAction,
                dependencyIds: [prepared.envelope.commandId],
                expectedEffect: inverseHandler.describe(inverseAction).label,
                options: { groupId: prepared.envelope.groupId, source: 'ai' },
            });
            const result: HandlerExecutionResult | void = await scope(() =>
                inverseHandler.execute(compensation.action)
            );
            if (result?.status === 'conflict' || result?.status === 'no-write') {
                throw new Error(`Runtime compensation did not apply for ${inverseAction.type}`);
            }
        }
        return null;
    } catch (error) {
        return failureReason(error);
    }
}

function recordCommittedBatch(
    preparedActions: readonly PreparedBatchAction[],
    options: ExecuteOptions | undefined
): void {
    const historyActions = preparedActions.filter(
        ({ description, handler }) => !options?.skipUndo && handler.undoable && description !== null
    );
    const historyGroupIds = historyActions.map(({ handler }) =>
        handler.batchExecution === 'singleton' ? undefined : options?.groupId
    );
    const firstHistoryGroupId = historyGroupIds[0];
    let stableHistoryGroupId: string | undefined;
    if (
        historyActions.length > 1 &&
        firstHistoryGroupId !== undefined &&
        historyGroupIds.every((groupId) => groupId === firstHistoryGroupId)
    ) {
        stableHistoryGroupId = firstHistoryGroupId;
    }
    const batchRestoreTracks: Array<{ trackId: string; trackIndex: number }> = [];
    const batchRestoreDevices: Array<{ trackId: string; deviceId: string; deviceIndex: number }> = [];
    for (const prepared of stableHistoryGroupId ? historyActions : []) {
        const inverseAction = prepared.description?.inverseAction;
        if (
            inverseAction?.type === 'restoreTrack' &&
            !batchRestoreTracks.some((candidate) => candidate.trackId === inverseAction.payload.trackId)
        ) {
            batchRestoreTracks.push({
                trackId: inverseAction.payload.trackId,
                trackIndex: inverseAction.payload.trackIndex,
            });
        }
        if (
            inverseAction?.type === 'restoreDevice' &&
            !batchRestoreDevices.some((candidate) => candidate.deviceId === inverseAction.payload.deviceSnapshot.id)
        ) {
            batchRestoreDevices.push({
                trackId: inverseAction.payload.trackId,
                deviceId: inverseAction.payload.deviceSnapshot.id,
                deviceIndex: inverseAction.payload.deviceIndex,
            });
        }
    }
    for (const prepared of preparedActions) {
        const { action, description, envelope, handler, label } = prepared;
        if (!options?.skipMacroRecording) {
            recordAction(action);
        }
        if (options?.skipUndo || !handler.undoable || !description) {
            continue;
        }

        const entryId = envelope.commandId;
        const historyGroupId = handler.batchExecution === 'singleton' ? undefined : options?.groupId;
        let inverseAction = description.inverseAction ?? null;
        if (
            inverseAction?.type === 'restoreTrack' &&
            historyGroupId === stableHistoryGroupId &&
            batchRestoreTracks.length > 1
        ) {
            inverseAction = {
                ...inverseAction,
                payload: {
                    ...inverseAction.payload,
                    batchRestoreTracks,
                },
            };
        }
        if (inverseAction?.type === 'restoreDevice' && historyGroupId === stableHistoryGroupId) {
            const restoreDeviceTrackId = inverseAction.payload.trackId;
            const siblingDevices = batchRestoreDevices.filter(
                (candidate) => candidate.trackId === restoreDeviceTrackId
            );
            if (siblingDevices.length > 1) {
                inverseAction = {
                    ...inverseAction,
                    payload: {
                        ...inverseAction.payload,
                        batchRestoreDevices: siblingDevices,
                    },
                };
            }
        }
        const historyGroupLabel = historyGroupId ? options?.groupLabel : undefined;
        const metadata = {
            id: entryId,
            label,
            actionKind: action.type,
            source: options?.source ?? 'manual',
            timestamp: envelope.issuedAt,
            groupId: historyGroupId,
            groupLabel: historyGroupLabel,
            reverted: false,
        };
        const evictedEntryIds = actionHistoryMetadataPort.record(metadata);
        for (const evictedEntryId of evictedEntryIds) {
            revokeActionReplayCapability(evictedEntryId);
        }
        if (inverseAction) {
            registerActionReplayCapability({
                entryId,
                inverseAction,
                metadata,
            });
        }

        const undoEntry = createUndoEntry(
            description.label,
            action,
            inverseAction,
            options?.source ?? 'manual',
            description.redoAction
        );
        if (historyGroupId) {
            undoEntry.groupId = historyGroupId;
            undoEntry.groupLabel = historyGroupLabel;
        }
        commitUndoEntry(undoEntry);
    }
}

export const executeAppActionBatch: ExecuteAppActionBatch = inject({ logger })(
    ({ logger }) =>
        async function executeAppActionBatch(
            actions: readonly AppAction[],
            options?: ExecuteAppActionBatchOptions
        ): Promise<ExecuteAppActionBatchResult> {
            if (actions.length === 0) {
                return { status: 'no-op', actions: [] };
            }
            if (options?.commandEnvelopes && options.commandEnvelopes.length !== actions.length) {
                return {
                    status: 'rejected',
                    reason: 'Command envelope count does not match action count',
                    actions: [],
                };
            }

            await waitForAutomergeSnapshotTransaction(options?.snapshotTransaction);
            if (options?.shouldExecute && !options.shouldExecute()) {
                return { status: 'cancelled', reason: 'Batch execution authority was revoked', actions: [] };
            }
            if (!productionBriefAdmissionPort.allows(actions)) {
                return {
                    status: 'conflicted',
                    reason: 'Action batch conflicts with locked production intent',
                    actions: [],
                };
            }

            const preparedActions: PreparedBatchAction[] = [];
            if (options?.commandEnvelopes && options.commandEnvelopes.length !== actions.length) {
                return {
                    status: 'rejected',
                    reason: 'Command envelope count does not match the action batch',
                    actions: [],
                };
            }
            for (const [index, action] of actions.entries()) {
                const handler = getHandler(action);
                if (!handler) {
                    return {
                        status: 'rejected',
                        reason: `No registered handler for action: ${action.type}`,
                        actions: [],
                    };
                }
                let description: HandlerDescribeResult | null;
                try {
                    description = null;
                    if (handler.undoable || handler.executionKind === 'runtime') {
                        description = handler.describe(action);
                    }
                } catch (error) {
                    return {
                        status: 'rejected',
                        reason: `Could not preflight ${action.type}: ${failureReason(error)}`,
                        actions: [],
                    };
                }
                if (
                    options?.requireCompensation &&
                    handler.executionKind !== 'runtime' &&
                    !description?.inverseAction
                ) {
                    return {
                        status: 'rejected',
                        reason: `Action is not compensable inside an atomic batch: ${action.type}`,
                        actions: [],
                    };
                }
                const suppliedEnvelope = options?.commandEnvelopes?.[index];
                if (
                    suppliedEnvelope &&
                    (suppliedEnvelope.operation !== action.type ||
                        suppliedEnvelope.groupId !== options.groupId ||
                        suppliedEnvelope.argumentsDigest !==
                            getVersionedCommandArgumentsDigest({
                                operation: action.type,
                                arguments: action.payload ?? {},
                            }))
                ) {
                    return {
                        status: 'rejected',
                        reason: `Command envelope does not match action ${action.type}`,
                        actions: [],
                    };
                }
                const command = suppliedEnvelope
                    ? { action, envelope: suppliedEnvelope }
                    : createExecutionCommandEnvelope({
                          action,
                          expectedEffect: description?.label ?? action.type,
                          options,
                      });
                preparedActions.push({
                    action: command.action,
                    afterAbort: null,
                    afterCommit: null,
                    afterAmbiguousCommit: null,
                    requiresAbortCompensation: handler.requiresAbortCompensation ?? true,
                    handler,
                    description,
                    envelope: command.envelope,
                    label: description?.label ?? action.type,
                });
            }

            if (preparedActions.length === 0) {
                return { status: 'no-op', actions: [] };
            }

            const singletonAction = findSingletonBatchAction(preparedActions.map((prepared) => prepared.action));
            if (singletonAction) {
                return {
                    status: 'rejected',
                    reason: `Action must execute as a singleton batch: ${singletonAction.type}`,
                    actions: [],
                };
            }

            const runtimeActions = preparedActions.filter((prepared) => prepared.handler.executionKind === 'runtime');
            if (runtimeActions.length > 0 && preparedActions.length !== 1) {
                return {
                    status: 'rejected',
                    reason: 'Runtime actions must execute as singleton batches',
                    actions: [],
                };
            }
            const runtimeAction = runtimeActions[0];
            if (runtimeAction) {
                return executeRuntimeAction(runtimeAction, options?.source, options?.shouldExecute);
            }

            for (const prepared of preparedActions) {
                traceAppAction(prepared.action.type, options?.source ?? 'manual');
            }

            setSemanticContext({
                message: options?.groupLabel ?? `Execute ${String(preparedActions.length)} actions`,
                actionKind: 'appActionBatch',
                entityRefs: [],
            });

            const attemptedActions: PreparedBatchAction[] = [];
            const storageTransaction = runWithAutomergeStorageTransaction(options?.snapshotTransaction, (scope) =>
                executePreparedBatch(preparedActions, scope, attemptedActions, options?.shouldExecute)
            );
            if (storageTransaction.status === 'threw') {
                storageTransaction.abort();
                clearBatchSemanticContext();
                const reason = failureReason(storageTransaction.error);
                logger.error(
                    new Error('Action batch rejected before asynchronous execution', {
                        cause: storageTransaction.error,
                    })
                );
                return { status: 'failed', reason, actions: [] };
            }

            let executedActions: PreparedBatchAction[];
            try {
                executedActions = await storageTransaction.value;
            } catch (error) {
                const compensationFailure = await compensateAttemptedBatch(attemptedActions, storageTransaction.scope);
                const rollbackFailure = await rollbackAttemptedBatch(attemptedActions, storageTransaction.scope);
                storageTransaction.abort();
                clearBatchSemanticContext();
                const baseReason = failureReason(error);
                const reason = appendAbortFailures(baseReason, compensationFailure, rollbackFailure);
                logger.error(new Error('Action batch handler failed', { cause: error }));
                if (error instanceof AppActionBatchCancelledError && !compensationFailure && !rollbackFailure) {
                    return { status: 'cancelled', reason: error.message, actions: [] };
                }
                if (error instanceof AppActionConflictError && !compensationFailure && !rollbackFailure) {
                    return { status: 'conflicted', reason, actions: [] };
                }
                return { status: 'failed', reason, actions: [] };
            }

            if (executedActions.length === 0) {
                storageTransaction.abort();
                clearBatchSemanticContext();
                return { status: 'no-op', actions: [] };
            }

            try {
                assertExecutionAuthorized(options?.shouldExecute);
            } catch (error) {
                const compensationFailure = await compensateAttemptedBatch(attemptedActions, storageTransaction.scope);
                const rollbackFailure = await rollbackAttemptedBatch(attemptedActions, storageTransaction.scope);
                storageTransaction.abort();
                clearBatchSemanticContext();
                if (compensationFailure || rollbackFailure) {
                    return {
                        status: 'failed',
                        reason: appendAbortFailures(failureReason(error), compensationFailure, rollbackFailure),
                        actions: [],
                    };
                }
                return { status: 'cancelled', reason: failureReason(error), actions: [] };
            }

            const committedActions = executedActions.map(({ action }) => action);

            try {
                storageTransaction.commit();
            } catch (error) {
                const cleanupWarning = clearBatchSemanticContext();
                const reason = failureReason(error);
                logger.error(new Error('Action batch storage commit failed', { cause: error }));
                if (error instanceof AutomergeStorageTransactionCommittedError) {
                    const reconciliationWarning = await reconcileAmbiguousRuntime(executedActions);
                    const warnings = [cleanupWarning, reconciliationWarning].filter(
                        (warning): warning is string => warning !== null
                    );
                    const ambiguousReason = warnings.length > 0 ? `${reason}; ${warnings.join('; ')}` : reason;
                    return {
                        status: 'ambiguous',
                        actions: [],
                        reason: ambiguousReason,
                    };
                }
                const compensationFailure = await compensateAttemptedBatch(attemptedActions, storageTransaction.scope);
                const rollbackFailure = await rollbackAttemptedBatch(attemptedActions, storageTransaction.scope);
                storageTransaction.abort();
                if (compensationFailure || rollbackFailure) {
                    return {
                        status: 'failed',
                        reason: appendAbortFailures(reason, compensationFailure, rollbackFailure),
                        actions: [],
                    };
                }
                return { status: 'failed', reason, actions: [] };
            }

            const executedBatchActions = executedActions.map(createExecutedBatchAction);
            const warnings: string[] = [];
            const semanticCleanupWarning = clearBatchSemanticContext();
            if (semanticCleanupWarning) {
                logger.error(new Error('Action batch semantic context cleanup failed'));
                warnings.push(semanticCleanupWarning);
            }

            try {
                options?.onCommitted?.(committedActions);
            } catch (error) {
                const warning = `Committed observer failed: ${failureReason(error)}`;
                logger.error(new Error(warning, { cause: error }));
                warnings.push(warning);
            }

            try {
                recordCommittedBatch(executedActions, options);
            } catch (error) {
                const warning = failureReason(error);
                logger.error(new Error('Action batch history recording failed after commit', { cause: error }));
                warnings.push(warning);
            }

            for (const executed of executedActions) {
                if (!executed.afterCommit) {
                    continue;
                }
                try {
                    await executed.afterCommit();
                } catch (effectError) {
                    if (!executed.afterAmbiguousCommit) {
                        const warning = `${executed.action.type} post-commit effect failed: ${failureReason(effectError)}`;
                        logger.error(new Error(warning, { cause: effectError }));
                        warnings.push(warning);
                        continue;
                    }

                    try {
                        await executed.afterAmbiguousCommit();
                    } catch (reconciliationError) {
                        const warning = `${executed.action.type} post-commit effect failed: ${failureReason(effectError)}; runtime reconciliation failed: ${failureReason(reconciliationError)}`;
                        logger.error(
                            new AggregateError(
                                [effectError, reconciliationError],
                                `${executed.action.type} post-commit effect and runtime reconciliation both failed`
                            )
                        );
                        warnings.push(warning);
                    }
                }
            }

            if (warnings.length > 0) {
                return {
                    status: 'committed-with-warning',
                    actions: executedBatchActions,
                    warning: warnings.join('; '),
                };
            }

            return { status: 'committed', actions: executedBatchActions };
        }
);
