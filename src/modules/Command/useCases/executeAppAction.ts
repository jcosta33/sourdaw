import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { runWithAutomergeStorageTransaction } from '#/infra/store/storage/createAutomergeStorage';
import { pushActionHistoryEntry, setSemanticContext, clearSemanticContext } from '#/modules/CrdtDocument/stores';

import { getHandlerMap } from '../stores/handlerRegistry';

import { type AppAction, type ActionHandler, createUndoEntry } from './commandQueries';
import { commitUndoEntry } from './commitUndoEntry';
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

export const executeAppAction = inject({ logger })(
    ({ logger }) =>
        async function executeAppAction(action: AppAction, options?: ExecuteOptions): Promise<void> {
            traceAppAction(action.type, options?.source ?? 'manual');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = getHandlerMap()[action.type] as ActionHandler<any> | undefined;
            if (!handler) {
                logger.error(new Error(`No handler registered for action: ${action.type}`));
                return;
            }

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
                logger.error(new Error(`Action handler rejected for action: ${action.type}`, { cause: error }));
                throw error;
            } finally {
                clearSemanticContext();
            }

            if (!options?.skipMacroRecording) {
                recordAction(action);
            }

            if (!options?.skipUndo) {
                // Record undoable actions to global history (skip UI-only actions like panel toggles)
                if (handler.undoable) {
                    pushActionHistoryEntry({
                        id: crypto.randomUUID(),
                        label,
                        actionKind: action.type,
                        action,
                        inverseAction: undoResult?.inverseAction ?? null,
                        source: options?.source ?? 'manual',
                        timestamp: Date.now(),
                        groupId: options?.groupId,
                        groupLabel: options?.groupLabel,
                        reverted: false,
                    });
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
        }
);
