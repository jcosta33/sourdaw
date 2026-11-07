import { executeAppAction } from '#/modules/Command/useCases';
import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';

import { startFirstPassAtRecordPoint } from '../../models/TakeLane';
import { clipEntrySeconds } from '../../models/TempoTimeline';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Clip } from '../../stores/trackStore';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { fitFlatTakesToClip } from './fitFlatTakesToClip';
import { placeRecordingClipStart } from './placeRecordingClipStart';
import { placeRecordingTakes } from './placeRecordingTakes';
import { RecordingRootMovedRefusal, recordingCommitGroups } from './recordingCommitGroup';
import { recordingPassTiming } from './recordingPassTiming';
import { stageRecordingTake } from './stageRecordingTake';
import { withMinimumRecordingLength } from './withMinimumRecordingLength';

/** Where a captured recording's media truly begins, as the capture terminal measured it. */
type RecordedCapture = {
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    provisionalStartBeat: number;
    /** The song time the capture's first sample sounds on, pre-roll lead and latency included. */
    mediaOriginSeconds: number;
    /** Producer sample zero less admission latency, on the audio context clock. */
    sourceContextOriginSeconds?: number;
    sourceDurationSeconds?: number;
};

function requireRecordingRoot(options?: { shouldExecute?: () => boolean }): void {
    if (options?.shouldExecute?.() === false) {
        throw new RecordingRootMovedRefusal();
    }
}

function stageFinalCapturedPass(clip: Clip, capture: RecordedCapture): void {
    if (
        capture.sourceContextOriginSeconds === undefined ||
        capture.sourceDurationSeconds === undefined ||
        capture.sourceDurationSeconds <= 0
    ) {
        return;
    }
    const finalPass = recordingPassTiming.finalPass(
        clip.id,
        capture.sourceContextOriginSeconds + capture.sourceDurationSeconds
    );
    if (!finalPass) {
        return;
    }
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === clip.trackId);
    const previous = lane?.takes.findLast((take) => take.clipId === clip.id && take.sourceOffsetBeats !== undefined);
    if (!previous || previous.sourceOffsetBeats === undefined) {
        return;
    }
    // The first staged wrap spans the loop, but its recording started at the
    // record point. Keep the existing unwrapped beat identity of later passes.
    const previousPass = startFirstPassAtRecordPoint(previous, capture.provisionalStartBeat);
    const provisional = lane?.takes.find((take) => take.clipId === clip.id && take.sourceOffsetBeats === undefined);
    if (!provisional) {
        throw new Error('Recording provisional take is not available');
    }
    stageRecordingTake({
        trackId: clip.trackId,
        clipId: clip.id,
        name: provisional.name,
        provisionalTakeId: provisional.id,
        ...finalPass,
        sourceOffsetBeats: previous.sourceOffsetBeats + previous.endBeat - previousPass.startBeat,
    });
}

/**
 * Place a captured clip on the beat its loop passes require and enter its
 * media at the capture's true origin. A loop recording begun inside the loop
 * has completed passes reaching before the clip's opening beat, so it opens at
 * the earliest of them; otherwise the clip keeps the beat the terminal placed
 * it on, a punch's included. Either way the offset is the capture's lead-in
 * before that first beat in seconds, converted at the tempo governing the beat
 * — the unit the readers seek in — and is negative when the clip opens before
 * its media begins. A punch that never wrapped still captured the hardware
 * latency before its beat, so the offset is written even when no pass moves the
 * clip; without it the take would enter its media at sample zero and sound
 * late by that lead. A clip that keeps its beat and whose media begins on it
 * stores no field, as the manual writer leaves an ordinary take: beats closer
 * than the clip-loop tolerance are one instant.
 */
function placeCapturedClip(clip: Clip, mediaOriginSeconds: number): Clip {
    const startBeat = placeRecordingClipStart(clip.id, clip.startBeat);
    const leadInSeconds = readSecondsAtBeat({ beat: startBeat }) - mediaOriginSeconds;
    const audioOffsetBeats = (leadInSeconds * readTempoAtBeat({ beat: startBeat })) / 60;
    if (startBeat === clip.startBeat && Math.abs(audioOffsetBeats) <= CLIP_LOOP_WINDOW_BEAT_TOLERANCE) {
        return clip;
    }
    return { ...clip, startBeat, audioOffsetBeats };
}

/** A continuous capture must also carry the retained passes placed on its loop geometry. */
function coverRecordedPasses(clip: Clip, capture: RecordedCapture): Clip {
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === clip.trackId);
    let capturedEnd: ReturnType<typeof recordingPassTiming.captureEnd> = undefined;
    if (capture.sourceContextOriginSeconds !== undefined && capture.sourceDurationSeconds !== undefined) {
        capturedEnd = recordingPassTiming.captureEnd(
            clip.id,
            capture.sourceContextOriginSeconds + capture.sourceDurationSeconds
        );
    }
    // Keep the original source as an editable handle. Ordinary base playback
    // ends at the gesture; genuine captured passes may still require a later
    // song beat after the last lap wrapped back to the loop start.
    let endBeat = capturedEnd ? Math.min(clip.endBeat, capturedEnd.endBeat) : clip.endBeat;
    for (const take of lane?.takes ?? []) {
        if (take.clipId === clip.id && take.passDepthSeconds !== undefined) {
            endBeat = Math.max(endBeat, take.endBeat);
        }
    }
    return endBeat === clip.endBeat ? clip : { ...clip, endBeat };
}

/**
 * Commit one completed recording gesture as a single semantic unit.
 *
 * The recorder opens the clip, its take lane, and its takes provisionally while
 * capture runs; this dispatch is the only history the gesture creates, and it is
 * called only once the capture has completed. The registered `commitRecording`
 * handler writes the recorded clip inside the owning transaction and captures a
 * complete inverse (`discardRecording`) and explicit redo (`restoreRecording`),
 * so one undo removes the clip together with the takes that name it and one redo
 * restores the same clip identity, placement, and take membership.
 *
 * An audio capture terminal hands in where its media truly begins. The clip is
 * placed against its loop passes first, then the staged takes are placed
 * against that committed clip's media origin, both before the dispatch so they
 * land in the one entry, which captures the live lane state; a flat take then
 * takes the committed clip's final extent. A MIDI recording
 * keeps the clip it opened, its passes bounded by that clip's start, and
 * commits without a capture.
 *
 * Deliberately `executeAppAction`, not `executeUserAppAction`: every caller
 * attaches its own rejection handler that retires the provisional recording and
 * tells the user, and the user-facing wrapper resolves a conflict-class refusal
 * (the project mutation gate, for one) after its own generic notice — which
 * would leave the staged clip, take, and notes behind with no entry and call it
 * a success (#4439). The wrapper keeps that behaviour for every other action.
 */
export async function commitRecording(
    clip: Clip,
    capture?: RecordedCapture,
    options?: { shouldExecute?: () => boolean }
): Promise<void> {
    // Placement changes projected take rows before dispatch. Check their owner
    // first, then repeat inside the dispatch after its snapshot-transaction wait.
    requireRecordingRoot(options);
    const submit = recordingCommitGroups.captureSubmission(clip.id);
    const passOwner = recordingPassTiming.ownedTakes(clip.id);
    const dispatchOptions = options && {
        shouldExecute: () => {
            requireRecordingRoot(options);
            return true;
        },
    };
    if (capture === undefined) {
        const action = { type: 'commitRecording' as const, payload: { clip } };
        await (submit ? submit(action, dispatchOptions?.shouldExecute) : executeAppAction(action, dispatchOptions));
        recordingPassTiming.retireIfOwner(clip.id, passOwner);
        return;
    }
    stageFinalCapturedPass(clip, capture);
    const placed = placeCapturedClip(clip, capture.mediaOriginSeconds);
    placeRecordingTakes({
        clipId: clip.id,
        recordPointBeat: capture.provisionalStartBeat,
        mediaOriginSeconds: capture.mediaOriginSeconds,
        sourceContextOriginSeconds: capture.sourceContextOriginSeconds,
        sourceDurationSeconds: capture.sourceDurationSeconds,
        clipMediaOriginSeconds:
            readSecondsAtBeat({ beat: placed.startBeat }) -
            clipEntrySeconds(liveTempoTimeline, placed.startBeat, placed.audioOffsetBeats ?? 0),
    });
    // The flat take follows the clip the handler will write, one-beat floor included.
    const committed = withMinimumRecordingLength(coverRecordedPasses(placed, capture));
    fitFlatTakesToClip(committed);
    const action = { type: 'commitRecording' as const, payload: { clip: committed } };
    await (submit ? submit(action, dispatchOptions?.shouldExecute) : executeAppAction(action, dispatchOptions));
    recordingPassTiming.retireIfOwner(clip.id, passOwner);
}
