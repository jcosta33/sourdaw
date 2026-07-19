import { commitUndoEntry } from './commitUndoEntry';
import { createCallbackUndoEntry } from './createCallbackUndoEntry';
import { isCommandHistoryReplaying } from './isCommandHistoryReplaying';
import { type CommitLegacyUndo, type LegacyCommandMutation } from './legacyCommandMutationContract';

export function runLegacyCommandMutationImpl<Output>(mutation: LegacyCommandMutation<Output>): Promise<Output> {
    const execute_under_owner = (): Promise<Output> | Output => {
        let history_committed = false;
        const commit_undo: CommitLegacyUndo = (label, undo, redo, options) => {
            if (isCommandHistoryReplaying()) {
                return;
            }
            if (history_committed) {
                throw new Error('A legacy Command mutation may publish only one undo entry');
            }
            history_committed = true;
            const entry = createCallbackUndoEntry({
                label,
                undo,
                redo,
                source: options?.source ?? 'manual',
            });
            if (options?.groupId) {
                entry.groupId = options.groupId;
                entry.groupLabel = options.groupLabel;
            }
            commitUndoEntry(entry);
        };
        return mutation(commit_undo);
    };

    try {
        return Promise.resolve(execute_under_owner());
    } catch (error) {
        return Promise.reject(error);
    }
}
