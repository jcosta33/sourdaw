import { createTake, createTakeLane, type Take, type TakeLane } from '../../models/TakeLane';
import { getTrackState } from '../../repositories/track/getTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Track } from '../../stores/trackStore';

import { closeRecordingPass, recordingPassOrigin } from './recordingPassOrigin';
import { recordingPassTiming } from './recordingPassTiming';
import { passSourceBeat } from './sourceBeat';

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
    /** This pass ends at an edit or a jump rather than at a loop wrap. */
    interruptsPass?: boolean;
};

function withoutPassIdentity(input: StageRecordingTakeInput): StageRecordingTakeInput {
    const { recordingPassIndex, ...unowned } = input;
    return recordingPassIndex === undefined ? input : unowned;
}

function isOwnedMidiWrapTake(track: Track, input: StageRecordingTakeInput): boolean {
    return (
        track.kind === 'midi' &&
        !activeRecordingRef.passIdentityLost &&
        input.recordingPassIndex !== undefined &&
        input.sourceOffsetBeats !== undefined
    );
}

/**
 * A wrap take of an owned MIDI pass starts where that pass's own events are
 * placed. A later pass opens no earlier than the beat it entered at: a loop start
 * moved back inside the pass names beats the pass never recorded.
 */
function placeMidiPassTake(track: Track, input: StageRecordingTakeInput): StageRecordingTakeInput {
    const clip = track.clips.find((candidate) => candidate.id === input.clipId);
    if (!isOwnedMidiWrapTake(track, input) || !clip || input.recordingPassIndex === undefined) {
        return input;
    }
    const origin = input.recordingPassIndex === 0 ? null : recordingPassOrigin(input.recordingPassIndex);
    const startBeat = origin ? Math.max(input.startBeat, origin.beat) : input.startBeat;
    const sourceOffsetBeats = passSourceBeat(clip.startBeat, input.recordingPassIndex, startBeat);
    return sourceOffsetBeats === null ? input : { ...input, startBeat, sourceOffsetBeats };
}

function nextOpenMidiTake(candidate: Take, input: StageRecordingTakeInput): Take {
    if (
        input.recordingPassIndex !== undefined &&
        input.sourceOffsetBeats !== undefined &&
        candidate.clipId === input.clipId &&
        candidate.sourceOffsetBeats === undefined
    ) {
        return { ...candidate, recordingPassIndex: input.recordingPassIndex + 1 };
    }
    return candidate;
}

function stageTakeInLane(
    existing: TakeLane,
    input: StageRecordingTakeInput,
    take: Take,
    replacement: Take | undefined
): TakeLane {
    if (existing.trackId !== input.trackId) {
        return existing;
    }
    if (!replacement) {
        const takes = existing.takes.map((candidate) => nextOpenMidiTake(candidate, input));
        return { ...existing, takes: [...takes, take] };
    }
    return {
        ...existing,
        takes: existing.takes.map((current) => (current.id === replacement.id ? take : current)),
    };
}

function replaceProvisionalTake(
    input: StageRecordingTakeInput,
    lane: TakeLane | undefined
): { take: Take; replacement: Take } {
    const replacement = lane?.takes.find((candidate) => candidate.id === input.provisionalTakeId);
    if (
        !replacement ||
        replacement.clipId !== input.clipId ||
        replacement.sourceOffsetBeats !== undefined ||
        input.sourceOffsetBeats === undefined
    ) {
        throw new Error('Recording provisional take is not available');
    }
    return {
        replacement,
        take: {
            ...replacement,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            sourceOffsetBeats: input.sourceOffsetBeats,
        },
    };
}

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
 * A returned clock receipt dates this same pass after roll admission without
 * publishing another take or changing the programme a pending start captured.
 */
export function stageRecordingTake(
    input: StageRecordingTakeInput
): ((passEndContextSeconds: number) => boolean) | undefined {
    const track = getTrackState()?.tracks.find((candidate) => candidate.id === input.trackId);
    if (!track || !recordingPassTiming.isCurrent(input.clipId, track.kind === 'midi' ? 'midi' : 'audio')) {
        return undefined;
    }
    if (
        input.recordingPassIndex !== undefined &&
        (!Number.isSafeInteger(input.recordingPassIndex) || input.recordingPassIndex < 0)
    ) {
        throw new Error('Invalid MIDI recording pass identity');
    }
    const placed = placeMidiPassTake(track, input);
    if (input.interruptsPass && track.kind === 'midi') {
        // Takes count staged passes and notes count loop wraps. A pass ended by an
        // edit or a jump is staged without a wrap, so from here neither names the
        // other and later notes and takes stay unowned, sounding in every take.
        activeRecordingRef.passIdentityLost = true;
    }
    const passInput = activeRecordingRef.passIdentityLost ? withoutPassIdentity(placed) : placed;
    const state = takeLaneStore.value;
    if (!state) {
        if (input.provisionalTakeId !== undefined) {
            throw new Error('Recording provisional take is not available');
        }
        return undefined;
    }
    if (isOwnedMidiWrapTake(track, passInput) && passInput.recordingPassIndex !== undefined) {
        closeRecordingPass(passInput.recordingPassIndex, input.endBeat, input.nextPassStartBeat ?? input.startBeat);
    }

    const lane = state.lanes.find((existing) => existing.trackId === input.trackId);
    let replacement: Take | undefined;
    let take: Take;
    if (input.provisionalTakeId !== undefined) {
        ({ take, replacement } = replaceProvisionalTake(input, lane));
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
            };
        } else {
            take = createTake(
                input.clipId,
                input.name,
                recordingPassTiming.nextStartBeat(input.clipId) ?? placed.startBeat,
                input.endBeat,
                placed.sourceOffsetBeats
            );
        }
    }
    if (passInput.recordingPassIndex !== undefined) {
        take.recordingPassIndex = passInput.recordingPassIndex;
    }
    recordingPassTiming.ownTake(input.clipId, take.id);
    recordingPassTiming.stage(take, input.passEndContextSeconds, input.plannedPassEnd);
    const finalizeClock = recordingPassTiming.capturePlannedClock(take);
    if (input.nextPassStartBeat !== undefined) {
        recordingPassTiming.relocateEntry(input.clipId, input.nextPassStartBeat);
    }
    if (!lane) {
        takeLaneStore.set({
            lanes: [...state.lanes, { ...createTakeLane(input.trackId), takes: [take] }],
        });
        return finalizeClock;
    }
    takeLaneStore.set({
        lanes: state.lanes.map((existing) => stageTakeInLane(existing, passInput, take, replacement)),
    });
    return finalizeClock;
}
