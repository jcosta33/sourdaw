import { type AppAction } from '../models/AppAction';
import { type ActionUndoEntry, type UndoSource } from '../models/UndoEntry';

export function createUndoEntry(
    label: string,
    action: AppAction,
    inverseAction: AppAction | null,
    source: UndoSource = 'manual'
): ActionUndoEntry {
    return {
        id: `undo-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'action',
        label,
        action,
        inverseAction,
        timestamp: Date.now(),
        source,
    };
}
