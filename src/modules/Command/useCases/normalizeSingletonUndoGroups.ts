import { type UndoEntry } from '../models/UndoEntry';
import { getHandler } from '../stores/handlerRegistry';
import { type UndoStoreState } from '../stores/undoStore';

function withoutGroup(entry: UndoEntry): UndoEntry {
    const ungrouped = { ...entry };
    delete ungrouped.groupId;
    delete ungrouped.groupLabel;
    return ungrouped;
}

export function normalizeSingletonUndoGroups(state: UndoStoreState): UndoStoreState {
    const entries = [...state.past, ...state.future];
    const groupCounts = new Map<string, number>();
    const singletonGroupIds = new Set<string>();
    for (const entry of entries) {
        if (!entry.groupId) {
            continue;
        }
        groupCounts.set(entry.groupId, (groupCounts.get(entry.groupId) ?? 0) + 1);
        if (entry.kind === 'action' && getHandler(entry.action)?.batchExecution === 'singleton') {
            singletonGroupIds.add(entry.groupId);
        }
    }
    const mixedSingletonGroupIds = new Set(
        [...singletonGroupIds].filter((groupId) => (groupCounts.get(groupId) ?? 0) > 1)
    );
    if (mixedSingletonGroupIds.size === 0) {
        return state;
    }
    function normalizeEntry(entry: UndoEntry): UndoEntry {
        if (entry.groupId && mixedSingletonGroupIds.has(entry.groupId)) {
            return withoutGroup(entry);
        }
        return entry;
    }
    return {
        past: state.past.map(normalizeEntry),
        future: state.future.map(normalizeEntry),
    };
}
