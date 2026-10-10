import { placeTakeOnClipMedia, startFirstPassAtRecordPoint } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { recordingPassTiming } from './recordingPassTiming';

type PlaceRecordingTakesInput = {
    clipId: string;
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    recordPointBeat: number;
    /** The song time the capture's first sample sounds on. */
    mediaOriginSeconds: number;
    /** The song time the committed clip's media begins on, as the readers read the clip. */
    clipMediaOriginSeconds: number;
    /** Producer sample-zero clock, corrected by the latency captured at admission. */
    sourceContextOriginSeconds?: number;
    sourceDurationSeconds?: number;
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
    let captureEnd: ReturnType<typeof recordingPassTiming.captureEnd>;
    if (input.sourceContextOriginSeconds !== undefined && input.sourceDurationSeconds !== undefined) {
        captureEnd = recordingPassTiming.captureEnd(
            input.clipId,
            input.sourceContextOriginSeconds + input.sourceDurationSeconds
        );
    }
    const placement = { ...input, timeline: liveTempoTimeline };
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => ({
            ...lane,
            takes: lane.takes.flatMap((take) => {
                if (take.clipId !== input.clipId) {
                    return take;
                }
                if (take.sourceOffsetBeats === undefined) {
                    return take;
                }
                if (input.sourceContextOriginSeconds === undefined) {
                    return placeTakeOnClipMedia(take, placement);
                }
                const placed = startFirstPassAtRecordPoint(take, input.recordPointBeat);
                let startBeat = placed.startBeat;
                let passDepthSeconds = recordingPassTiming.depthSeconds(
                    take,
                    input.sourceContextOriginSeconds,
                    input.mediaOriginSeconds
                );
                // An input grant can arrive after this pass opened. Keep only
                // its captured tail; a negative depth would invent earlier PCM.
                if (passDepthSeconds < 0) {
                    startBeat = liveTempoTimeline.beatAtSeconds(
                        liveTempoTimeline.secondsAtBeat(startBeat) - passDepthSeconds
                    );
                    passDepthSeconds = 0;
                }
                let endBeat = placed.endBeat;
                if (captureEnd && captureEnd.takeId === take.id) {
                    endBeat = Math.min(endBeat, captureEnd.endBeat);
                }
                if (endBeat <= startBeat) {
                    return [];
                }
                return {
                    ...placed,
                    startBeat,
                    endBeat,
                    passAnchorSeconds: liveTempoTimeline.secondsAtBeat(startBeat) - input.clipMediaOriginSeconds,
                    passDepthSeconds,
                };
            }),
        })),
    });
}
