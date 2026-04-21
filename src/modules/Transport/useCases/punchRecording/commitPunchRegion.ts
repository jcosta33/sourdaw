import { pushUndoEntry } from '#/modules/Command/useCases';

import { punchRecordingStore, type PunchRecordingState } from '../../stores/punchRecordingStore';

export function commitPunchRegion(captureId: string, regionId: string): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    const capture = state.captures.find((c) => c.id === captureId);
    const region = capture?.punchRegions.find((r) => r.id === regionId);
    if (!region || region.committed) {
        return;
    }

    const previous: PunchRecordingState = state;
    const next: PunchRecordingState = {
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureId
                ? {
                      ...c,
                      punchRegions: c.punchRegions.map((r) => (r.id === regionId ? { ...r, committed: true } : r)),
                  }
                : c
        ),
    };
    punchRecordingStore.set(next);

    pushUndoEntry(
        'Commit punch region',
        () => punchRecordingStore.set(previous),
        () => punchRecordingStore.set(next)
    );
}
