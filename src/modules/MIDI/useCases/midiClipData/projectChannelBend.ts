import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';

import { createStoredBendRangeReader } from './createStoredBendRangeReader';
import { type ControllerProjectionClip } from './listClipControllerPasses';
import { projectClipPitchBendEvents } from './projectClipPitchBendEvents';

type ChannelBendClip = {
    clip: ControllerProjectionClip;
    /** The clip's stored controllers: the RPN 0 messages among them say how deep its bend is. */
    controlChanges: readonly MidiCC[];
    pitchBends: readonly MidiPitchBend[];
};

type ProjectChannelBendInput = {
    /**
     * Every clip of the track whose stored bend plays, in the order the scheduler posts them: at
     * one sample frame a later clip's bend lands after an earlier clip's.
     */
    clips: readonly ChannelBendClip[];
    /**
     * The sample frame a note at this beat is posted at: the caller's own clock, the one that places its notes.
     * It must not clamp a beat before its own origin (an export region's start) to one frame, because frames
     * order the moves: two moves that clamp together would be ordered by clip sequence, not timeline position.
     */
    frameAtBeat: (beat: number) => number;
    /** The timeline window `[fromBeat, toBeat)` to list; the whole timeline when absent. */
    fromBeat?: number;
    toBeat?: number;
};

/** One move of the track's channel bend, in the units a voice's expression takes. */
type ChannelBendPoint = {
    beat: number;
    frame: number;
    /**
     * Where the move was recorded, on the timeline of the pass that plays it: `beat`, except for a carry,
     * which a pass head plays though the row was recorded before it (`projectClipPitchBendEvents`).
     */
    recordedBeat: number;
    /** The signed 14-bit wire delta, -8192..8191, 0 at centre. */
    value: number;
    /** The depth `value` is read against, in semitones: the one in force where the row was recorded, even for a carry. */
    rangeSemitones: number;
    /** The zero-based MIDI channel the row was recorded on: a move bends the notes of that channel. */
    channel: number;
    /** Whether the row bends only the notes of its own channel (`MidiPitchBend.channelScoped`). */
    channelScoped: boolean;
};

type PlacedBend = { point: ChannelBendPoint; clipIndex: number; rowIndex: number };

/**
 * The track's channel pitch bend over the whole timeline, or over the window `[fromBeat, toBeat)`
 * when one is given: every move of every clip's stored bend lane, in the order the instrument
 * receives them.
 *
 * A bend the recorder captured from a channel's wheel belongs to that MIDI channel, as the live
 * input plays it outside MPE: a note struck while its channel's bend is in force sounds under
 * it, and a note sounding when a move on its channel arrives is moved; a move on another channel
 * leaves it alone. The recorder says so on the row (`MidiPitchBend.channelScoped`), and the point
 * carries it with the row's channel. Every other row (drawn in the lane, imported, saved before
 * rows were scoped, or an MPE zone master's, which reaches every member channel) is unscoped and
 * bends every note of the track. The caller reads the bend in force for a note as the last move
 * at or before its frame that reaches the note. Nothing resets at a clip end: a bend stays where
 * the last row put it until a row says otherwise, as CC1 does, so the clip after one that ended
 * bent starts bent.
 *
 * "Last" is the posting order, by sample frame, then clip sequence, then the clip's own row
 * order, never by float beat: two rows a rounding step apart in beat share a frame, and the
 * instrument ends on the later clip's, as `projectClipControllerRestore` orders stored
 * controllers. Every move comes from `projectClipPitchBendEvents`, so a clip's passes, offset
 * and carry place a bend as they place a controller.
 */
export function projectChannelBend({
    clips,
    frameAtBeat,
    fromBeat = Number.NEGATIVE_INFINITY,
    toBeat = Number.POSITIVE_INFINITY,
}: ProjectChannelBendInput): ChannelBendPoint[] {
    const placed: PlacedBend[] = [];
    for (const [clipIndex, { clip, controlChanges, pitchBends }] of clips.entries()) {
        if (pitchBends.length === 0) {
            continue;
        }
        const readRange = createStoredBendRangeReader(controlChanges);
        const bends = projectClipPitchBendEvents({ pitchBends, clip, fromBeat, toBeat });
        for (const [rowIndex, bend] of bends.entries()) {
            placed.push({
                point: {
                    beat: bend.beat,
                    frame: frameAtBeat(bend.beat),
                    recordedBeat: bend.recordedBeat,
                    value: bend.value,
                    rangeSemitones: readRange(bend.channel, bend.recordedContentBeat),
                    channel: bend.channel,
                    channelScoped: bend.channelScoped === true,
                },
                clipIndex,
                rowIndex,
            });
        }
    }
    return placed
        .sort(
            (left, right) =>
                left.point.frame - right.point.frame ||
                left.clipIndex - right.clipIndex ||
                left.rowIndex - right.rowIndex
        )
        .map(({ point }) => point);
}
