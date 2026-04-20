import { groupCompingStore, getNextGroupId, type CompGroupEntry } from '../../../stores/groupComping';

export function createCompGroup(name: string, trackIds: string[]): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    const group: CompGroupEntry = {
        id: getNextGroupId(),
        name,
        trackIds,
        takeSets: [],
        activeTakeSetId: null,
        compRegions: [],
        createdAt: new Date().toISOString(),
    };
    groupCompingStore.set({ ...state, groups: [...state.groups, group], activeGroupId: group.id });
}
