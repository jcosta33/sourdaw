import { groupCompingStore, getNextGroupId, type CompGroupEntry } from '../../../stores/groupComping';

export function createCompGroup(name: string, trackIds: string[], groupIdOverride?: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
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
}
