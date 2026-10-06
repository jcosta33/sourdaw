import { trimTakeStart } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

type TakeStart = { takeId: string; startBeat: number; sourceOffsetBeats: number };

type PlanTrimmedTakeStartsInput = {
    clipId: string;
    previousStartBeat: number;
    newStartBeat: number;
};

type TrimmedTakeStarts = { before: TakeStart[]; after: TakeStart[] };

/**
 * The loop-pass takes of a clip that a start trim moves, as the starts they
 * hold now and the starts they hold once the trim lands.
 *
 * Only a trim toward later beats hides anything: a pass begins before its clip
 * when recording started inside the loop, and extending the clip earlier must
 * leave that pass exactly as recorded.
 */
export function planTrimmedTakeStarts(input: PlanTrimmedTakeStartsInput): TrimmedTakeStarts {
    const plan: TrimmedTakeStarts = { before: [], after: [] };
    const state = takeLaneStore.value;
    if (!state || input.newStartBeat <= input.previousStartBeat) {
        return plan;
    }
    for (const lane of state.lanes) {
        for (const take of lane.takes) {
            if (take.clipId !== input.clipId) {
                continue;
            }
            const trimmed = trimTakeStart(take, input.newStartBeat);
            if (trimmed === take || take.sourceOffsetBeats === undefined || trimmed.sourceOffsetBeats === undefined) {
                continue;
            }
            plan.before.push({
                takeId: take.id,
                startBeat: take.startBeat,
                sourceOffsetBeats: take.sourceOffsetBeats,
            });
            plan.after.push({
                takeId: take.id,
                startBeat: trimmed.startBeat,
                sourceOffsetBeats: trimmed.sourceOffsetBeats,
            });
        }
    }
    return plan;
}
