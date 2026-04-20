import { groupCompingStore, getNextRegionId, type GroupCompRegion } from '../../../stores/groupComping';

export function swipeGroupComp(grpId: string, takeSetIdVal: string, startBeat: number, endBeat: number): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    const region: GroupCompRegion = {
        id: getNextRegionId(),
        startBeat,
        endBeat,
        takeSetId: takeSetIdVal,
        crossfadeBeats: state.defaultCrossfade,
    };
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((g) => {
            if (g.id !== grpId) {
                return g;
            }
            const cleaned = g.compRegions.filter((r) => r.endBeat <= startBeat || r.startBeat >= endBeat);
            return { ...g, compRegions: [...cleaned, region].sort((a, b) => a.startBeat - b.startBeat) };
        }),
    });
}
