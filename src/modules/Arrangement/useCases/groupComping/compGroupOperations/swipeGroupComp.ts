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
        groups: state.groups.map((gain) => {
            if (gain.id !== grpId) {
                return gain;
            }
            const cleaned = gain.compRegions.filter((r) => r.endBeat <= startBeat || r.startBeat >= endBeat);
            return {
                ...gain,
                compRegions: [...cleaned, region].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat),
            };
        }),
    });
}
