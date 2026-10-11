import { placeTakeOnClipMedia } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { liveTempoTimeline } from '../liveTempoTimeline';

type PlaceRecordingTakesInput = {
    clipId: string;
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    recordPointBeat: number;
    /** The song time the capture's first sample sounds on. */
    mediaOriginSeconds: number;
    /** The song time the committed clip's media begins on, as the readers read the clip. */
    clipMediaOriginSeconds: number;
};

/**
 * Place every pass of an audio recording against its committed clip before the
 * commit, without a history entry. The takes are still provisional; the commit
 * captures the live lane state into its redo, so the placed takes land in the
 * same single entry the clip does.
 */
export function placeRecordingTakes(input: PlaceRecordingTakesInput): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    const placement = { ...input, timeline: liveTempoTimeline };
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
