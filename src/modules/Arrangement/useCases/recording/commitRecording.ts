import { executeAppAction } from '#/modules/Command/useCases';
import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';

import { startFirstPassAtRecordPoint } from '../../models/TakeLane';
import { clipEntrySeconds } from '../../models/TempoTimeline';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Clip } from '../../stores/trackStore';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { placeRecordingClipStart } from './placeRecordingClipStart';
import { placeRecordingTakes } from './placeRecordingTakes';
import { recordingPassTiming } from './recordingPassTiming';
import { stageRecordingTake } from './stageRecordingTake';

/** Where a captured recording's media truly begins, as the capture terminal measured it. */
type RecordedCapture = {
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    provisionalStartBeat: number;
    /** The song time the capture's first sample sounds on, pre-roll lead and latency included. */
    mediaOriginSeconds: number;
    /** Producer sample zero less admission latency, on the audio context clock. */
    sourceContextOriginSeconds: number;
    sourceDurationSeconds?: number;
};

function stageFinalCapturedPass(clip: Clip, capture: RecordedCapture): void {
    if (capture.sourceDurationSeconds === undefined || capture.sourceDurationSeconds <= 0) {
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
 * Open a captured clip where its loop passes require. The capture terminal has
 * already placed it on its media origin or, under pre-roll, on the record
 * point; a loop recording begun inside the loop opens earlier still, at its
 * first pass. The offset is then rewritten in the unit the readers seek in —
 * the capture's lead-in before the clip's first beat in seconds, converted at
 * the tempo governing that beat — and is negative when the clip opens before
 * its media begins.
 */
function placeCapturedClip(clip: Clip, mediaOriginSeconds: number): Clip {
    const startBeat = placeRecordingClipStart(clip.id, clip.startBeat);
    if (startBeat === clip.startBeat) {
        return clip;
    }
    const leadInSeconds = readSecondsAtBeat({ beat: startBeat }) - mediaOriginSeconds;
    return { ...clip, startBeat, audioOffsetBeats: (leadInSeconds * readTempoAtBeat({ beat: startBeat })) / 60 };
}

/** A continuous capture must also carry the retained passes placed on its loop geometry. */
function coverRecordedPasses(clip: Clip, capture: RecordedCapture): Clip {
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === clip.trackId);
    let capturedEnd: ReturnType<typeof recordingPassTiming.captureEnd> = undefined;
    if (capture.sourceDurationSeconds !== undefined) {
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
 * land in the one entry, which captures the live lane state. A MIDI recording
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
export async function commitRecording(clip: Clip, capture?: RecordedCapture): Promise<void> {
    if (capture === undefined) {
        await executeAppAction({ type: 'commitRecording', payload: { clip } });
        recordingPassTiming.retire(clip.id);
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
    await executeAppAction({ type: 'commitRecording', payload: { clip: coverRecordedPasses(placed, capture) } });
    recordingPassTiming.retire(clip.id);
}
