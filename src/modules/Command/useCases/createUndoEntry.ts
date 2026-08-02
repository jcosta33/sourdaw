import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry, type UndoSource } from '../models/UndoEntry';

export function createUndoEntry(
    label: string,
    action: AppAction,
    inverseAction: AppAction | null,
    source: UndoSource = 'manual',
    redoAction?: AppAction
): ActionUndoEntry {
    const entry: ActionUndoEntry = {
        id: `undo-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'action',
        label,
        action,
        inverseAction,
        timestamp: Date.now(),
        source,
    };
    if (redoAction) {
        entry.redoAction = redoAction;
    }
    return entry;
}
