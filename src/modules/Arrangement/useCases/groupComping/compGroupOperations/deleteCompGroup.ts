import { groupCompingStore } from '#/modules/Arrangement/stores/groupComping';

export function deleteCompGroup(grpId: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.filter((g) => g.id !== grpId),
        activeGroupId: state.activeGroupId === grpId ? null : state.activeGroupId,
    });
}