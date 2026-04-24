import { groupCompingStore } from '../../../stores/groupComping';

export function deleteCompGroup(grpId: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.filter((gain) => gain.id !== grpId),
        activeGroupId: state.activeGroupId === grpId ? null : state.activeGroupId,
    });
}
