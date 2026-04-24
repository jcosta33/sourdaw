import { type ActionHistoryEntry } from '../../stores/actionHistoryStore';

/**
 * Check whether a history entry can be safely reverted.
 */
export function canRevertAction(entry: ActionHistoryEntry): boolean {
    if (entry.reverted) {
        return false;
    }
    if (!entry.inverseAction) {
        return false;
    }
    return true;
}
