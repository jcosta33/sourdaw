import { createTake, createTakeLane, type Take } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { recordingPassTiming } from './recordingPassTiming';

type StageRecordingTakeInput = {
    trackId: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    sourceOffsetBeats?: number;
    /** Reuse this recording's still-open audio take when its final lap closes. */
    provisionalTakeId?: string;
    /** Physical seam ending this recorded pass, on the capture clock. */
    passEndContextSeconds?: number;
    plannedPassEnd?: boolean;
    nextPassStartBeat?: number;
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
        if (input.provisionalTakeId !== undefined) {
            throw new Error('Recording provisional take is not available');
        }
        return;
    }

    const lane = state.lanes.find((existing) => existing.trackId === input.trackId);
    let replacement: Take | undefined;
    let take: Take;
    if (input.provisionalTakeId !== undefined) {
        replacement = lane?.takes.find((candidate) => candidate.id === input.provisionalTakeId);
        if (
            !replacement ||
            replacement.clipId !== input.clipId ||
            replacement.sourceOffsetBeats !== undefined ||
            input.sourceOffsetBeats === undefined
        ) {
            throw new Error('Recording provisional take is not available');
        }
        take = {
            ...replacement,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            sourceOffsetBeats: input.sourceOffsetBeats,
        };
    } else {
        const replacementId = recordingPassTiming.replacementTakeId(input.clipId);
        if (replacementId !== undefined) {
            replacement = lane?.takes.find((candidate) => candidate.id === replacementId);
        }
        if (replacement) {
            take = { ...replacement, endBeat: input.endBeat };
        } else {
            take = createTake(
                input.clipId,
                input.name,
                recordingPassTiming.nextStartBeat(input.clipId) ?? input.startBeat,
                input.endBeat,
                input.sourceOffsetBeats
            );
        }
    }
    recordingPassTiming.stage(take, input.passEndContextSeconds, input.plannedPassEnd);
    if (input.nextPassStartBeat !== undefined) {
        recordingPassTiming.relocateEntry(input.clipId, input.nextPassStartBeat);
    }
    if (!lane) {
        takeLaneStore.set({
            lanes: [...state.lanes, { ...createTakeLane(input.trackId), takes: [take] }],
        });
        return;
    }
    takeLaneStore.set({
        lanes: state.lanes.map((existing) => {
            if (existing.trackId !== input.trackId) {
                return existing;
            }
            if (!replacement) {
                return { ...existing, takes: [...existing.takes, take] };
            }
            return {
                ...existing,
                takes: existing.takes.map((current) => (current.id === replacement.id ? take : current)),
            };
        }),
    });
}
