import { groupCompingStore, getNextTakeSetId, GROUP_COLORS, type CompTakeSet } from '../../../stores/groupComping';

export function addGroupTakeSet(grpId: string, name: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((g) => {
            if (g.id !== grpId) {
                return g;
            }
            const ts: CompTakeSet = {
                id: getNextTakeSetId(),
                name,
                pass: g.takeSets.length + 1,
                color: GROUP_COLORS[g.takeSets.length % GROUP_COLORS.length]!,
                recordedAt: new Date().toISOString(),
            };
            return {
                ...g,
                takeSets: [...g.takeSets, ts],
                activeTakeSetId: g.activeTakeSetId ?? ts.id,
            };
        }),
    });
}