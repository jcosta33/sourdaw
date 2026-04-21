import { pushUndoEntry } from '#/modules/Command/useCases';

import { getNextPunchId } from '../../repositories/punchRecordingIdCounter/getNextPunchId';
import { punchRecordingStore, type PunchRecordingState, type PunchRegion } from '../../stores/punchRecordingStore';

export function definePunchRegion(captureId: string, punchInBeat: number, punchOutBeat: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }

    const capture = state.captures.find((c) => c.id === captureId);
    if (!capture) {
        return;
    }

    const region: PunchRegion = {
        id: getNextPunchId(),
        trackId: capture.trackId,
        punchInBeat,
        punchOutBeat,
        sourceClipId: capture.id,
        preRollBeats: state.defaultPreRoll,
        postRollBeats: state.defaultPostRoll,
        committed: false,
        crossfadeBeats: state.defaultCrossfade,
    };

    const previous: PunchRecordingState = state;
    const next: PunchRecordingState = {
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureId ? { ...c, punchRegions: [...c.punchRegions, region] } : c
        ),
    };
    punchRecordingStore.set(next);

    pushUndoEntry(
        'Define punch region',
        () => punchRecordingStore.set(previous),
        () => punchRecordingStore.set(next)
    );
}
