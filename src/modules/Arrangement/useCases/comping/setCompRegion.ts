import { type CompRegion } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

export function setCompRegion(trackId: string, region: CompRegion): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.map((l) => {
            if (l.trackId !== trackId) {
                return l;
            }

            const filtered = l.activeCompRegions.filter(
                (r) => r.endBeat <= region.startBeat || r.startBeat >= region.endBeat
            );

            return {
                ...l,
                activeCompRegions: [...filtered, region].sort((a, b) => a.startBeat - b.startBeat),
            };
        }),
    });
}
