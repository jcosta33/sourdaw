import { createTake, createTakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

type StageRecordingTakeInput = {
    trackId: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    sourceOffsetBeats?: number;
};

/**
 * Open a take for an in-flight recording without a history entry.
 *
 * The recorder owns the provisional half of the gesture: it opens the clip, its
 * take lane, and its takes while capture runs, and commits the whole result as
 * ONE entry when the capture succeeds (`commitRecording`). Pushing the ordinary
 * take-lane entries here would leave the lane and the take as separate history
 * above a clip no entry covers — the split this gesture exists to close — and an
 * incomplete capture would leave a replayable take behind. `addTake` and
 * `addTakeLane` stay the history-bearing routes for every non-recording gesture,
 * and for armed MIDI tracks, whose notes are committed by their own actions.
 */
export function stageRecordingTake(input: StageRecordingTakeInput): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    const take = createTake(input.clipId, input.name, input.startBeat, input.endBeat, input.sourceOffsetBeats);
    const lane = state.lanes.find((existing) => existing.trackId === input.trackId);
    if (!lane) {
        takeLaneStore.set({
            lanes: [...state.lanes, { ...createTakeLane(input.trackId), takes: [take] }],
        });
        return;
    }
    takeLaneStore.set({
        lanes: state.lanes.map((existing) =>
            existing.trackId === input.trackId ? { ...existing, takes: [...existing.takes, take] } : existing
        ),
    });
}
