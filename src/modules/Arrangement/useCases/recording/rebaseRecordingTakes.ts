import { rebaseTakeOntoMedia } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

type RebaseRecordingTakesInput = {
    clipId: string;
    provisionalStartBeat: number;
    shiftBeats: number;
};

/**
 * Rebase every take of a recording clip before its commit, without a history
 * entry. The takes are still provisional; the commit captures the live lane
 * state into its redo, so the rebased offsets land in the same single entry the
 * clip does.
 */
export function rebaseRecordingTakes(input: RebaseRecordingTakesInput): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => ({
            ...lane,
            takes: lane.takes.map((take) => {
                if (take.clipId !== input.clipId) {
                    return take;
                }
                return rebaseTakeOntoMedia(take, input.provisionalStartBeat, input.shiftBeats);
            }),
        })),
    });
}
