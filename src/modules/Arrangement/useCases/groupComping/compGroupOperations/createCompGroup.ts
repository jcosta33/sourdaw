import { groupCompingStore, getNextGroupId, type CompGroupEntry } from '../../../stores/groupComping';

/**
 * Returns whether a group was actually appended. The caller needs that answer: a
 * command whose execute wrote nothing must report `no-write` rather than let an undo
 * entry be filed, because that entry's inverse can only ever conflict and a conflicted
 * entry stays on the stack, refusing every later undo press.
 */
export function createCompGroup(name: string, trackIds: string[], groupIdOverride?: string): boolean {
    const state = groupCompingStore.value;
    if (!state) {
        return false;
    }
    // `groupIdOverride` carries the id `materializeCommandApplicationIds` minted before
    // `describe()` ran, so the undo inverse can name this exact group instead of guessing
    // the newest one.
    const group: CompGroupEntry = {
        id: groupIdOverride ?? getNextGroupId(),
        name,
        trackIds,
        takeSets: [],
        activeTakeSetId: null,
        compRegions: [],
        createdAt: new Date().toISOString(),
    };
    groupCompingStore.set({ ...state, groups: [...state.groups, group], activeGroupId: group.id });
    return true;
}
