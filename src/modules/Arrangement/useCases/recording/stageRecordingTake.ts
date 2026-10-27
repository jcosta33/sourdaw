import { createTake, createTakeLane, type Take } from '../../models/TakeLane';
import { getTrackState } from '../../repositories/track/getTrackState';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { recordingPassTiming } from './recordingPassTiming';

type StageRecordingTakeInput = {
    trackId: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    sourceOffsetBeats?: number;
    recordingPassIndex?: number;
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
    const track = getTrackState()?.tracks.find((candidate) => candidate.id === input.trackId);
    if (!track || !recordingPassTiming.isCurrent(input.clipId, track.kind === 'midi' ? 'midi' : 'audio')) {
        return;
    }
    if (
        input.recordingPassIndex !== undefined &&
        (!Number.isSafeInteger(input.recordingPassIndex) || input.recordingPassIndex < 0)
    ) {
        throw new Error('Invalid MIDI recording pass identity');
    }
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
            ...(input.recordingPassIndex === undefined ? {} : { recordingPassIndex: input.recordingPassIndex }),
        };
    } else {
        const replacementId = recordingPassTiming.replacementTakeId(input.clipId);
        if (replacementId !== undefined) {
            replacement = lane?.takes.find(
                (candidate) => candidate.id === replacementId && candidate.clipId === input.clipId
            );
        }
        if (replacement) {
            take = {
                ...replacement,
                endBeat: input.endBeat,
                ...(input.recordingPassIndex === undefined ? {} : { recordingPassIndex: input.recordingPassIndex }),
            };
        } else {
            take = createTake(
                input.clipId,
                input.name,
                recordingPassTiming.nextStartBeat(input.clipId) ?? input.startBeat,
                input.endBeat,
                input.sourceOffsetBeats
            );
            if (input.recordingPassIndex !== undefined) {
                take.recordingPassIndex = input.recordingPassIndex;
            }
        }
    }
    recordingPassTiming.ownTake(input.clipId, take.id);
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
                const takes = existing.takes.map((candidate) =>
                    input.recordingPassIndex !== undefined &&
                    input.sourceOffsetBeats !== undefined &&
                    candidate.clipId === input.clipId &&
                    candidate.sourceOffsetBeats === undefined
                        ? { ...candidate, recordingPassIndex: input.recordingPassIndex + 1 }
                        : candidate
                );
                return { ...existing, takes: [...takes, take] };
            }
            return {
                ...existing,
                takes: existing.takes.map((current) => (current.id === replacement.id ? take : current)),
            };
        }),
    });
}
