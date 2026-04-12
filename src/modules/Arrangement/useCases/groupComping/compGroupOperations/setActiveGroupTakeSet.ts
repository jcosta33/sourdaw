import { groupCompingStore } from '../../../stores/groupComping';

export function setActiveGroupTakeSet(grpId: string, tsId: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((g) => (g.id === grpId ? { ...g, activeTakeSetId: tsId } : g)),
    });
}