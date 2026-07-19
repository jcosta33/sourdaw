import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import {
    runWithAutomergeStorageTransaction,
    waitForAutomergeSnapshotTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { setSemanticContext, clearSemanticContext } from '#/modules/CrdtDocument/stores';
import { type ActionExecutionResult, type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { AppActionCommittedError, AppActionNotDispatchedError } from '../errors/AppActionExecutionError';
import { registerActionReplayCapability, revokeActionReplayCapability } from '../stores/actionReplayCapabilities';
import { getHandler } from '../stores/handlerRegistry';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { commitUndoEntry } from './commitUndoEntry';
import { createUndoEntry } from './createUndoEntry';
import { recordAction } from './macro/recording/recordAction';
import { traceAppAction } from './traceAppAction';

type ExecuteAppActionImpl = (action: AppAction, options?: ExecuteOptions) => Promise<void>;

function normalize_action_execution_result(result: void | ActionExecutionResult): ActionExecutionResult {
    if (!result) {
        return { applied: true };
    }
    return result;
}

export const executeAppActionImpl: ExecuteAppActionImpl = inject({ logger })(
    ({ logger }) =>
        async function executeAppActionImpl(action: AppAction, options?: ExecuteOptions): Promise<void> {
            traceAppAction(action.type, options?.source ?? 'manual');

            const handler = getHandler(action);
            if (!handler) {
                const error = new AppActionNotDispatchedError(action.type);
                logger.error(error);
                throw error;
            }

            await waitForAutomergeSnapshotTransaction(options?.snapshotTransaction);

            // Capture undo info before execution so destructive actions can snapshot current state.
            let undoResult: { label: string; inverseAction?: AppAction | null } | null = null;
            if (handler.undoable) {
                undoResult = handler.describe(action);
            }
            options?.onUndoPrepared?.(undoResult);

            // Give Automerge changes a readable semantic description.
            const label = undoResult?.label ?? action.type;
            setSemanticContext({
                message: label,
                actionKind: action.type,
                entityRefs: [],
            });

            let execution_result: void | ActionExecutionResult;
            try {
                const execution = runWithAutomergeStorageTransaction(options?.snapshotTransaction, () =>
                    handler.execute(action, { executeAppAction: executeAppActionImpl })
                );
                execution_result = await execution;
            } catch (error) {
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
                clearSemanticContext();
            } catch (error) {
                const committed_error = new AppActionCommittedError(action.type, error);
                logger.error(committed_error);
                throw committed_error;
            }

            const action_execution_result = normalize_action_execution_result(execution_result);
            try {
                options?.onExecuted?.(action_execution_result);
            } catch (error) {
                const committed_error = new AppActionCommittedError(action.type, error);
                logger.error(committed_error);
                throw committed_error;
            }
            if (!action_execution_result.applied) {
                return;
            }

            try {
                if (!options?.skipMacroRecording) {
                    // Preserve user actions for macro playback.
                    recordAction(action);
                }

                if (!options?.skipUndo) {
                    // UI-only and other non-undoable actions stay outside global history.
                    if (handler.undoable) {
                        const entry_id = crypto.randomUUID();
                        const inverse_action = undoResult?.inverseAction ?? null;
                        const metadata = {
                            id: entry_id,
                            label,
                            actionKind: action.type,
                            source: options?.source ?? 'manual',
                            timestamp: Date.now(),
                            groupId: options?.groupId,
                            groupLabel: options?.groupLabel,
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

                    if (undoResult?.inverseAction) {
                        const entry = createUndoEntry(
                            undoResult.label,
                            action,
                            undoResult.inverseAction,
                            options?.source ?? 'manual'
                        );
                        if (options?.groupId) {
                            entry.groupId = options.groupId;
                            entry.groupLabel = options.groupLabel;
                            if (
                                options.atomicUndoGroup &&
                                undoResult.inverseAction.type === 'restoreAdjustmentLayerMutation'
                            ) {
                                entry.transactionGroupId = options.groupId;
                            }
                        }
                        commitUndoEntry(entry);
                    }
                }
            } catch (error) {
                const committed_error = new AppActionCommittedError(action.type, error);
                logger.error(committed_error);
                throw committed_error;
            }
        }
);
