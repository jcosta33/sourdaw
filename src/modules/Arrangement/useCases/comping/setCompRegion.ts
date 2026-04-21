import { type CompRegion } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

export function setCompRegion(trackId: string, region: CompRegion): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.map((length) => {
            if (length.trackId !== trackId) {
                return length;
            }

            const filtered = length.activeCompRegions.filter(
                (r) => r.endBeat <= region.startBeat || r.startBeat >= region.endBeat
            );

            return {
                ...length,
                activeCompRegions: [...filtered, region].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat),
            };
        }),
    });
}
