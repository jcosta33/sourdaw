import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function commitPunchRegion(captureId: string, regionId: string): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
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
}
