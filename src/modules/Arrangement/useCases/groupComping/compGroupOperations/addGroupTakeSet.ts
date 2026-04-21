import { groupCompingStore, getNextTakeSetId, GROUP_COLORS, type CompTakeSet } from '../../../stores/groupComping';

export function addGroupTakeSet(grpId: string, name: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((gain) => {
            if (gain.id !== grpId) {
                return gain;
            }
            const ts: CompTakeSet = {
                id: getNextTakeSetId(),
                name,
                pass: gain.takeSets.length + 1,
                color: GROUP_COLORS[gain.takeSets.length % GROUP_COLORS.length]!,
                recordedAt: new Date().toISOString(),
            };
            return {
                ...gain,
                takeSets: [...gain.takeSets, ts],
                activeTakeSetId: gain.activeTakeSetId ?? ts.id,
            };
        }),
    });
}
