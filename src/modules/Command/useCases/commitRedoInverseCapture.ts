import { type AppAction } from '#/utils/handlerContract';

import { undoStore } from '../stores/undoStore';

/** Install an execution-prefix capture only after its project transaction committed. */
export function commitRedoInverseCapture(replayAction: AppAction, inverseAction: AppAction): void {
    const entry = undoStore.value?.future.find(
        (candidate) => candidate.kind === 'action' && (candidate.redoAction ?? candidate.action) === replayAction
    );
    if (entry?.kind === 'action' && entry.inverseAction?.type === inverseAction.type) {
        entry.inverseAction = inverseAction;
    }
}
