import { punchRecordingStore, type PunchRegion } from '#/modules/Transport/stores/punchRecordingStore';
import { getNextPunchId } from '#/modules/Transport/models/punchRecordingHelpers';

export function definePunchRegion(
    captureId: string,
    punchInBeat: number,
    punchOutBeat: number
): void {
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

    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureId
                ? { ...c, punchRegions: [...c.punchRegions, region] }
                : c
        ),
    });
}
