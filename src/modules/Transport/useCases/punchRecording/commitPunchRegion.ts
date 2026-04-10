import { inject } from '#/infra/di/inject';
import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export const commitPunchRegion = inject({ punchRecordingStore })(({ punchRecordingStore: store }) => {
    return function commitPunchRegion(captureId: string, regionId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            captures: state.captures.map((c) =>
                c.id === captureId
                    ? {
                          ...c,
                          punchRegions: c.punchRegions.map((r) =>
                              r.id === regionId ? { ...r, committed: true } : r
                          ),
                      }
                    : c
            ),
        });
    };
});
