import { executeAppAction } from '#/modules/Command/useCases';
import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';

import { type Clip } from '../../stores/trackStore';

import { placeRecordingClipStart } from './placeRecordingClipStart';
import { rebaseRecordingTakes } from './rebaseRecordingTakes';

/** Where a captured recording's media truly begins, as the capture terminal measured it. */
type RecordedCapture = {
    /** The beat the recorder opened the clip on, which every staged take was minted against. */
    provisionalStartBeat: number;
    /** The beat and song time the capture's first sample sounds on, pre-roll lead and latency included. */
    mediaOriginBeat: number;
    mediaOriginSeconds: number;
};

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
 * A capture terminal hands in where its media truly begins. The clip is placed
 * against its loop passes first, then the staged takes are rebased onto that
 * origin, both before the dispatch so they land in the one entry, which
 * captures the live lane state. A MIDI recording is placed and rebased by
 * `stopRecording` and commits without one.
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
        return;
    }
    const placed = placeCapturedClip(clip, capture.mediaOriginSeconds);
    rebaseRecordingTakes({
        clipId: clip.id,
        provisionalStartBeat: capture.provisionalStartBeat,
        shiftBeats: capture.provisionalStartBeat - capture.mediaOriginBeat,
    });
    await executeAppAction({ type: 'commitRecording', payload: { clip: placed } });
}
