import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import {
    AutomergeStorageTransactionCommittedError,
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
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';
import { registerActionReplayCapability, revokeActionReplayCapability } from '../stores/actionReplayCapabilities';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { commitUndoEntry } from './commitUndoEntry';
import { createExecutionCommandEnvelope } from './createExecutionCommandEnvelope';
import { createUndoEntry } from './createUndoEntry';
import { getCommandHandler } from './getCommandHandler';
import { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';
import { recordAction } from './macro/recording/recordAction';
import { materializeCommandApplicationIds } from './materializeCommandApplicationIds';
import { productionBriefAdmissionPort } from './productionBriefAdmissionPort';
import { traceAppAction } from './traceAppAction';

type ExecuteAppActionOptions = ExecuteOptions & {
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
                    runtime_result = await handler.execute(action);
                } catch (error) {
                    logger.error(new Error(`Action handler rejected for action: ${action.type}`, { cause: error }));
                    throw error;
                }

                if (runtime_result?.status === 'no-write') {
                    return;
                }
                if (runtime_result?.status === 'conflict') {
                    throw new AppActionConflictError(action.type);
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

            if (!productionBriefAdmissionPort.allows([action])) {
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
                handler.execute(action)
            );
            if (storage_transaction.status === 'threw') {
                storage_transaction.abort();
                const error = storage_transaction.error;
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
                throw error;
            }
            try {
                execution_result = await storage_transaction.value;
            } catch (error) {
                storage_transaction.abort();
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
                throw error;
            }

            if (execution_result?.status === 'no-write') {
                storage_transaction.abort();
                clearSemanticContext();
                return;
            }
            if (execution_result?.status === 'conflict') {
                storage_transaction.abort();
                clearSemanticContext();
                throw new AppActionConflictError(action.type);
            }

            try {
                storage_transaction.commit();
            } catch (error) {
                storage_transaction.abort();
                try {
                    clearSemanticContext();
                } catch (clear_error) {
                    logger.error(
                        new Error(`Semantic context cleanup failed for action: ${action.type}`, {
                            cause: clear_error,
                        })
                    );
                }
                if (error instanceof AutomergeStorageTransactionCommittedError) {
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
                logger.error(new Error(`Action storage commit failed for action: ${action.type}`, { cause: error }));
                throw error;
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
                        if (historyGroupId) {
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
