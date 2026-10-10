import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import {
    AutomergeStorageTransactionCommittedError,
    AutomergeStorageTransactionValidationError,
    AutomergeStorageWriteConflictError,
    runWithAutomergeStorageTransaction,
    waitForAutomergeSnapshotTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { setSemanticContext, clearSemanticContext } from '#/modules/CrdtDocument/stores';
import { type AppAction, type ExecuteOptions, type HandlerExecutionResult } from '#/utils/handlerContract';

import {
    AppActionCommittedError,
    AppActionConflictError,
    AppActionNotDispatchedError,
} from '../errors/AppActionExecutionError';
import { isActionEntry } from '../models/UndoEntry';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';
import { registerActionReplayCapability, revokeActionReplayCapability } from '../stores/actionReplayCapabilities';
import { undoStore } from '../stores/undoStore';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { appendAbortFailures } from './appendAbortFailures';
import { commitUndoEntry } from './commitUndoEntry';
import { type AbortCompensation, compensateAbortedActions } from './compensateAbortedActions';
import { createExecutionCommandEnvelope } from './createExecutionCommandEnvelope';
import { createUndoEntry } from './createUndoEntry';
import { getCommandHandler } from './getCommandHandler';
import { getProjectMutationAdmissionFailure } from './getProjectMutationAdmissionFailure';
import { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';
import { recordAction } from './macro/recording/recordAction';
import { materializeCommandApplicationIds } from './materializeCommandApplicationIds';
import { materializeCommandHandlerArguments } from './materializeCommandHandlerArguments';
import { productionBriefAdmissionPort } from './productionBriefAdmissionPort';
import { rollbackAbortedActions } from './rollbackAbortedActions';
import { traceAppAction } from './traceAppAction';

export type ExecuteAppActionOptions = ExecuteOptions & {
    commandEnvelope?: VersionedCommandEnvelope;
    onCommitted?: () => void;
};

type ExecuteAppAction = (action: AppAction, options?: ExecuteAppActionOptions) => Promise<void>;

function collapseCommittedFailures(failures: readonly unknown[], message: string): unknown {
    if (failures.length === 1) {
        return failures[0];
    }
    return new AggregateError(failures, message);
}

type AttemptedAction = {
    readonly actionType: string;
    readonly rollback: (() => void | Promise<void>) | null;
    readonly compensation: AbortCompensation;
};

type AbortFailures = {
    readonly compensation: string | null;
    readonly rollback: string | null;
};

/**
 * Undoes what the handler changed outside the document, inside the still-open
 * transaction, and aborts it. Compensation, then rollback, then abort, in the
 * batch's order: both read the state the action left, and an aborted transaction
 * refuses re-entry. Returns their failures, which the caller reports in place of
 * the abort's own cause.
 */
async function compensateRollbackAndAbort(
    transaction: Pick<ReturnType<typeof runWithAutomergeStorageTransaction>, 'abort' | 'scope'>,
    attempted: AttemptedAction
): Promise<AbortFailures> {
    const compensation = await compensateAbortedActions([attempted.compensation], transaction.scope);
    const rollback = await rollbackAbortedActions([attempted], transaction.scope);
    transaction.abort();
    return { compensation, rollback };
}

function hasAbortFailure(failures: AbortFailures | null): boolean {
    return failures !== null && (failures.compensation !== null || failures.rollback !== null);
}

/** A failed compensation or rollback leaves the runtime out of step with the document, so it outranks a retryable conflict. */
function withAbortFailures(error: unknown, failures: AbortFailures | null): unknown {
    if (!failures || !hasAbortFailure(failures)) {
        return error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new Error(appendAbortFailures(reason, failures.compensation, failures.rollback), { cause: error });
}

/**
 * The singular `*Id` fields a payload names its target by. Same-type actions
 * share one payload schema, so the ids present decide the comparison; a value
 * that is not a primitive id (arrays, nested snapshots) names no direct target.
 */
function coalesceTargetIds(action: AppAction): Map<string, string | number> {
    const payload: Record<string, unknown> = action.payload ?? {};
    const targets = new Map<string, string | number>();
    for (const [field, value] of Object.entries(payload)) {
        if (!field.endsWith('Id')) {
            continue;
        }
        if (typeof value === 'string' || typeof value === 'number') {
            targets.set(field, value);
        }
    }
    return targets;
}

/**
 * Whether a coalescing action may merge into the previous entry's action.
 *
 * Matching the action type alone let a double-click reset on one track join an
 * older, unrelated fader move on another (#4616): the reset adopted that
 * entry's group and one Undo reverted both. The ids must name the same target,
 * and an id field only one side carries refuses the merge. A payload with no
 * id field targets a singleton (the master fader) and stays type-only.
 */
function coalesceTargetsMatch(previous: AppAction, next: AppAction): boolean {
    if (previous.type !== next.type) {
        return false;
    }
    const previousTargets = coalesceTargetIds(previous);
    const nextTargets = coalesceTargetIds(next);
    if (previousTargets.size !== nextTargets.size) {
        return false;
    }
    for (const [field, value] of previousTargets) {
        if (nextTargets.get(field) !== value) {
            return false;
        }
    }
    return true;
}

export const executeAppAction: ExecuteAppAction = inject({ logger })(
    ({ logger }) =>
        async function executeAppAction(action: AppAction, options?: ExecuteAppActionOptions): Promise<void> {
            const materialized = options?.commandEnvelope
                ? { action, applicationAssignedIds: options.commandEnvelope.applicationAssignedIds }
                : materializeCommandApplicationIds(action);
            action = materialized.action;
            traceAppAction(action.type, options?.source ?? 'manual');

            const handler = getCommandHandler(action);
            if (!handler) {
                const error = new AppActionNotDispatchedError(action.type);
                logger.error(error);
                throw error;
            }
            action = materializeCommandHandlerArguments(action, handler);
            const historyGroupId = handler.batchExecution === 'singleton' ? undefined : options?.groupId;
            const historyGroupLabel = historyGroupId ? options?.groupLabel : undefined;
            if (
                options?.commandEnvelope &&
                (options.commandEnvelope.operation !== action.type ||
                    options.commandEnvelope.argumentsDigest !==
                        getVersionedCommandArgumentsDigest({
                            operation: action.type,
                            arguments: action.payload ?? {},
                        }))
            ) {
                throw new Error(`Command envelope does not match action ${action.type}`);
            }

            if (handler.executionKind === 'runtime') {
                if (options?.shouldExecute && !options.shouldExecute()) {
                    return;
                }

                if (handler.isNoop?.(action)) {
                    return;
                }

                const command = options?.commandEnvelope
                    ? { action, envelope: options.commandEnvelope }
                    : createExecutionCommandEnvelope({
                          action,
                          applicationAssignedIds: materialized.applicationAssignedIds,
                          expectedEffect: action.type,
                          options,
                      });
                action = command.action;

                let runtime_result: HandlerExecutionResult | void;
                try {
                    runtime_result = await handler.execute(action, {
                        actions: [action],
                        actionIndex: 0,
                        signal: options?.signal,
                        onDeferredEffectAttempt: options?.onDeferredEffectAttempt,
                        workOwner: options?.workOwner,
                    });
                } catch (error) {
                    logger.error(new Error(`Action handler rejected for action: ${action.type}`, { cause: error }));
                    throw error;
                }

                if (runtime_result?.status === 'no-write') {
                    return;
                }
                if (runtime_result?.status === 'conflict') {
                    throw new AppActionConflictError(action.type, runtime_result.reason);
                }

                const committed_failures: unknown[] = [];
                try {
                    options?.onCommitted?.();
                } catch (error) {
                    committed_failures.push(error);
                }
                try {
                    await runtime_result?.afterRuntimeExecution?.();
                } catch (error) {
                    committed_failures.push(error);
                }
                if (committed_failures.length > 0) {
                    const cause = collapseCommittedFailures(
                        committed_failures,
                        'Runtime action and committed observer both completed with errors'
                    );
                    const committed_error = new AppActionCommittedError(action.type, cause);
                    logger.error(committed_error);
                    throw committed_error;
                }
                return;
            }

            await waitForAutomergeSnapshotTransaction(options?.snapshotTransaction);

            if (options?.shouldExecute && !options.shouldExecute()) {
                return;
            }

            // The repair action itself is the one admitted route through this
            // gate while it holds; everything else is still refused.
            if (getProjectMutationAdmissionFailure(action)) {
                throw new AppActionConflictError(action.type);
            }

            const production_brief_admission = productionBriefAdmissionPort.capture([action]);
            if (!production_brief_admission.allowsCurrent()) {
                throw new AppActionConflictError(action.type);
            }

            if (handler.isNoop?.(action)) {
                return;
            }

            // Capture undo info BEFORE executing — this lets describe() snapshot current
            // state for destructive actions like removeTrack / removeClip.
            let undoResult: {
                label: string;
                inverseAction?: AppAction | null;
                redoAction?: AppAction;
            } | null = null;
            if (handler.undoable) {
                undoResult = handler.describe(action);
            }

            const command = options?.commandEnvelope
                ? { action, envelope: options.commandEnvelope }
                : createExecutionCommandEnvelope({
                      action,
                      applicationAssignedIds: materialized.applicationAssignedIds,
                      expectedEffect: undoResult?.label ?? action.type,
                      options,
                  });
            action = command.action;

            // Captured against the same store state the handler is about to read, before
            // anything is written, exactly where the batch path captures it.
            // The batch reports a handler that needs compensation but described no inverse as a
            // failed abort. A single action has no atomic-batch preflight that refuses such a
            // handler up front, and every non-undoable handler is one, so here an absent inverse
            // means nothing to replay and the abort keeps its own classification.
            const inverseAction = undoResult?.inverseAction ?? null;
            const attempted: AttemptedAction = {
                actionType: action.type,
                rollback: handler.prepareAbort?.(action) ?? null,
                compensation: {
                    actionType: action.type,
                    requiresAbortCompensation: (handler.requiresAbortCompensation ?? true) && inverseAction !== null,
                    inverseAction,
                    commandId: command.envelope.commandId,
                    groupId: command.envelope.groupId,
                },
            };

            // Set semantic context so AutomergeStorage attaches a message to the CRDT change.
            // This makes `Automerge.getHistory()` return readable change descriptions.
            const label = undoResult?.label ?? action.type;
            setSemanticContext({
                message: label,
                actionKind: action.type,
                entityRefs: [],
            });

            let execution_result: HandlerExecutionResult | void;
            const storage_transaction = runWithAutomergeStorageTransaction(options?.snapshotTransaction, () =>
                handler.execute(action, {
                    actions: [action],
                    actionIndex: 0,
                    signal: options?.signal,
                    onDeferredEffectAttempt: options?.onDeferredEffectAttempt,
                    workOwner: options?.workOwner,
                })
            );
            if (storage_transaction.status === 'threw') {
                const error = storage_transaction.error;
                const abortFailures = await compensateRollbackAndAbort(storage_transaction, attempted);
                try {
                    clearSemanticContext();
                } catch (clear_error) {
                    logger.error(
                        new Error(`Semantic context cleanup failed for action: ${action.type}`, {
                            cause: clear_error,
                        })
                    );
                }
                logger.error(new Error(`Action handler rejected for action: ${action.type}`, { cause: error }));
                if (error instanceof AutomergeStorageWriteConflictError && !hasAbortFailure(abortFailures)) {
                    throw new AppActionConflictError(action.type);
                }
                throw withAbortFailures(error, abortFailures);
            }
            storage_transaction.validateCommit(getProjectMutationAdmissionFailure);
            let production_brief_commit_denied = false;
            storage_transaction.validateCommit(() => {
                production_brief_commit_denied = !production_brief_admission.allowsCurrent();
                return production_brief_commit_denied
                    ? `Action conflicts with current project state: ${action.type}`
                    : null;
            });
            try {
                execution_result = await storage_transaction.value;
            } catch (error) {
                const abortFailures = await compensateRollbackAndAbort(storage_transaction, attempted);
                try {
                    clearSemanticContext();
                } catch (clear_error) {
                    logger.error(
                        new Error(`Semantic context cleanup failed for action: ${action.type}`, {
                            cause: clear_error,
                        })
                    );
                }
                logger.error(new Error(`Action handler rejected for action: ${action.type}`, { cause: error }));
                if (error instanceof AutomergeStorageWriteConflictError && !hasAbortFailure(abortFailures)) {
                    throw new AppActionConflictError(action.type);
                }
                throw withAbortFailures(error, abortFailures);
            }

            // A handler that reports no write or a conflict declined before changing
            // anything, as the batch path treats it, so there is nothing to roll back; a
            // rollback would also write the runtime past the eligibility checks that refused.
            if (execution_result?.status === 'no-write') {
                storage_transaction.abort();
                clearSemanticContext();
                return;
            }
            if (execution_result?.status === 'conflict') {
                const refusal = execution_result.reason;
                storage_transaction.abort();
                clearSemanticContext();
                throw new AppActionConflictError(action.type, refusal);
            }

            try {
                storage_transaction.commit();
            } catch (error) {
                // A commit that already reached storage cannot be undone by rolling the
                // runtime back; the ambiguous-commit reconciliation below owns that case.
                const reachedStorage = error instanceof AutomergeStorageTransactionCommittedError;
                const abortFailures = reachedStorage
                    ? null
                    : await compensateRollbackAndAbort(storage_transaction, attempted);
                if (reachedStorage) {
                    storage_transaction.abort();
                }
                try {
                    clearSemanticContext();
                } catch (clear_error) {
                    logger.error(
                        new Error(`Semantic context cleanup failed for action: ${action.type}`, {
                            cause: clear_error,
                        })
                    );
                }
                if (reachedStorage) {
                    const committedFailures: unknown[] = [error.cause];
                    try {
                        await execution_result?.afterAmbiguousCommit?.();
                    } catch (reconciliationError) {
                        committedFailures.push(reconciliationError);
                    }
                    const committedCause = collapseCommittedFailures(
                        committedFailures,
                        'Storage commit or runtime reconciliation failed'
                    );
                    const committed_error = new AppActionCommittedError(action.type, committedCause);
                    logger.error(committed_error);
                    throw committed_error;
                }
                if (
                    !hasAbortFailure(abortFailures) &&
                    production_brief_commit_denied &&
                    error instanceof AutomergeStorageTransactionValidationError
                ) {
                    throw new AppActionConflictError(action.type);
                }
                if (!hasAbortFailure(abortFailures) && error instanceof AutomergeStorageWriteConflictError) {
                    throw new AppActionConflictError(action.type);
                }
                logger.error(new Error(`Action storage commit failed for action: ${action.type}`, { cause: error }));
                throw withAbortFailures(error, abortFailures);
            }

            let committed_failure: unknown;
            try {
                clearSemanticContext();
            } catch (error) {
                committed_failure = error;
            }

            try {
                options?.onCommitted?.();

                if (!options?.skipMacroRecording) {
                    // Record to macro playback
                    recordAction(action);
                }

                if (!options?.skipUndo) {
                    // Record undoable actions to global history (skip UI-only actions like panel toggles)
                    if (handler.undoable) {
                        const entry_id = command.envelope.commandId;
                        const inverse_action = undoResult?.inverseAction ?? null;
                        const metadata = {
                            id: entry_id,
                            label,
                            actionKind: action.type,
                            source: options?.source ?? 'manual',
                            timestamp: command.envelope.issuedAt,
                            groupId: historyGroupId,
                            groupLabel: historyGroupLabel,
                            reverted: false,
                        };
                        const evicted_entry_ids = actionHistoryMetadataPort.record(metadata);
                        for (const evicted_entry_id of evicted_entry_ids) {
                            revokeActionReplayCapability(evicted_entry_id);
                        }
                        if (inverse_action) {
                            registerActionReplayCapability({
                                entryId: entry_id,
                                inverseAction: inverse_action,
                                metadata,
                            });
                        }
                    }

                    if (undoResult) {
                        const entry = createUndoEntry(
                            undoResult.label,
                            action,
                            undoResult.inverseAction ?? null,
                            options?.source ?? 'manual',
                            undoResult.redoAction
                        );
                        const previousEntry = undoStore.value?.past.at(-1);
                        if (
                            options?.coalesceWithPrevious &&
                            previousEntry &&
                            isActionEntry(previousEntry) &&
                            coalesceTargetsMatch(previousEntry.action, action)
                        ) {
                            const groupId = previousEntry.groupId ?? `group-${crypto.randomUUID().slice(0, 8)}`;
                            previousEntry.groupId = groupId;
                            entry.groupId = groupId;
                            if (previousEntry.groupLabel) {
                                entry.groupLabel = previousEntry.groupLabel;
                            }
                        } else if (historyGroupId) {
                            entry.groupId = historyGroupId;
                            entry.groupLabel = historyGroupLabel;
                        }
                        commitUndoEntry(entry);
                    }
                }
            } catch (error) {
                committed_failure ??= error;
            }

            try {
                await execution_result?.afterCommit?.();
            } catch (effect_error) {
                const reconcile_runtime = execution_result?.afterAmbiguousCommit;
                if (!reconcile_runtime) {
                    committed_failure ??= effect_error;
                } else {
                    try {
                        await reconcile_runtime();
                    } catch (reconciliation_error) {
                        const runtime_failure = new AggregateError(
                            [effect_error, reconciliation_error],
                            'Post-commit effect and runtime reconciliation both failed'
                        );
                        if (committed_failure) {
                            committed_failure = new AggregateError(
                                [committed_failure, runtime_failure],
                                'Post-commit processing and runtime recovery failed'
                            );
                        } else {
                            committed_failure = runtime_failure;
                        }
                    }
                }
            }

            if (committed_failure) {
                const committed_error = new AppActionCommittedError(action.type, committed_failure);
                logger.error(committed_error);
                throw committed_error;
            }
        }
);
