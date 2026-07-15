import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import {
    runWithAutomergeStorageTransaction,
    waitForAutomergeSnapshotTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { setSemanticContext, clearSemanticContext } from '#/modules/CrdtDocument/stores';

import { AppActionCommittedError, AppActionNotDispatchedError } from '../errors/AppActionExecutionError';
import { type AppAction } from '../models/AppAction';
import { registerActionReplayCapability, revokeActionReplayCapability } from '../stores/actionReplayCapabilities';
import { getHandler } from '../stores/handlerRegistry';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';
import { commitUndoEntry } from './commitUndoEntry';
import { createUndoEntry } from './createUndoEntry';
import { recordAction } from './macro/recording/recordAction';
import { traceAppAction } from './traceAppAction';

export type ExecuteOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: 'manual' | 'prompt' | 'voice' | 'ai';
    /** When true, skip pushing an undo entry and action history entry.
     *  Use this when the caller manages batch undo externally (e.g. executeDsoEdit). */
    skipUndo?: boolean;
    /** Opaque owner for CRDT writes made synchronously by this action. */
    snapshotTransaction?: object;
    /** When true, do not capture this execution in an active macro recording. */
    skipMacroRecording?: boolean;
};

type ExecuteAppAction = (action: AppAction, options?: ExecuteOptions) => Promise<void>;

export const executeAppAction: ExecuteAppAction = inject({ logger })(
    ({ logger }) =>
        async function executeAppAction(action: AppAction, options?: ExecuteOptions): Promise<void> {
            traceAppAction(action.type, options?.source ?? 'manual');

            const handler = getHandler(action);
            if (!handler) {
                const error = new AppActionNotDispatchedError(action.type);
                logger.error(error);
                throw error;
            }

            await waitForAutomergeSnapshotTransaction(options?.snapshotTransaction);

            // Capture undo info BEFORE executing — this lets describe() snapshot current
            // state for destructive actions like removeTrack / removeClip.
            let undoResult: { label: string; inverseAction?: AppAction | null } | null = null;
            if (handler.undoable) {
                undoResult = handler.describe(action);
            }

            // Set semantic context so AutomergeStorage attaches a message to the CRDT change.
            // This makes `Automerge.getHistory()` return readable change descriptions.
            const label = undoResult?.label ?? action.type;
            setSemanticContext({
                message: label,
                actionKind: action.type,
                entityRefs: [],
            });

            try {
                const execution = runWithAutomergeStorageTransaction(options?.snapshotTransaction, () =>
                    handler.execute(action)
                );
                await execution;
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

            try {
                if (!options?.skipMacroRecording) {
                    // Record to macro playback
                    recordAction(action);
                }

                if (!options?.skipUndo) {
                    // Record undoable actions to global history (skip UI-only actions like panel toggles)
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

                    if (undoResult) {
                        const entry = createUndoEntry(
                            undoResult.label,
                            action,
                            undoResult.inverseAction ?? null,
                            options?.source ?? 'manual'
                        );
                        if (options?.groupId) {
                            entry.groupId = options.groupId;
                            entry.groupLabel = options.groupLabel;
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
