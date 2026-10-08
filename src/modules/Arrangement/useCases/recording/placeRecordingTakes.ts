import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';

import { placeTakeOnClipMedia } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

type PlaceRecordingTakesInput = {
    clipId: string;
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    recordPointBeat: number;
    /** The song time the capture's first sample sounds on. */
    mediaOriginSeconds: number;
    /** The committed clip's media origin: its start less its media offset. */
    clipMediaOriginBeat: number;
};

const timeline = {
    secondsAtBeat: (beat: number) => readSecondsAtBeat({ beat }),
    tempoAtBeat: (beat: number) => readTempoAtBeat({ beat }),
};

/**
 * Place every take of an audio recording against its committed clip before the
 * commit, without a history entry. The takes are still provisional; the commit
 * captures the live lane state into its redo, so the placed takes land in the
 * same single entry the clip does.
 */
export function placeRecordingTakes(input: PlaceRecordingTakesInput): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    const placement = { ...input, timeline };
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => ({
            ...lane,
            takes: lane.takes.map((take) => {
                if (take.clipId !== input.clipId) {
                    return take;
                }
                return placeTakeOnClipMedia(take, placement);
            }),
        })),
    });
}
