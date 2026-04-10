import { inject } from '#/infra/di/inject';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { type CompRegion } from '#/modules/Arrangement/models/TakeLane';

export const setCompRegion = inject({ takeLaneStore })(({ takeLaneStore: store }) => {
    return function setCompRegion(trackId: string, region: CompRegion): void {
        const state = store.value;
        if (!state) {
            return;
        }

        store.set({
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
    };
});
