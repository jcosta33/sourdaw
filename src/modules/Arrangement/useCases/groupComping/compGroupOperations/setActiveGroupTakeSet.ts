import { groupCompingStore } from '../../../stores/groupComping';

export function setActiveGroupTakeSet(grpId: string, tsId: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((gain) => (gain.id === grpId ? { ...gain, activeTakeSetId: tsId } : gain)),
    });
}
