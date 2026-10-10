import { type MidiCC } from '../../models/MidiNote';

import { projectClipControllerEvents, type ProjectedClipControllerMove } from './projectClipControllerEvents';

type ControllerRestoreClip = Parameters<typeof projectClipControllerEvents>[0]['clip'];

type ProjectClipControllerRestoreInput = {
    /**
     * Every clip of the track whose stored controllers play, in the order the window posts them: at one
     * sample frame a later clip's move lands after an earlier clip's. A clip need not span the
     * destination: one before it still holds the value its last row left.
     */
    clips: readonly { clip: ControllerRestoreClip; controlChanges: readonly MidiCC[] }[];
    /** The timeline beat playback has just been relocated to, where the window `[atBeat, windowToBeat)` opens. */
    atBeat: number;
    windowToBeat: number;
    /** The sample frame a controller at this beat is posted at: the window's own notion of "at the same time". */
    sampleFrameAtBeat: (beat: number) => number;
};

type ClipControllerRestore = {
    /** The value in force at `atBeat` for each controller the scheduler window opening there does not end on itself, placed at `atBeat`. */
    moves: MidiCC[];
    /** Every controller number that has a value in force at `atBeat`, whether `moves` carries it or the window opening there does. */
    held: ReadonlySet<number>;
};

type PostedController = {
    event: ProjectedClipControllerMove;
    sampleFrame: number;
    /** A clip's moves on the frame its closing-line move plays on apply before other clips' moves there. */
    sameFrameRank: number;
    clipIndex: number;
    /** Where the clip's own projection put it: beat order, ties in source order. */
    rowIndex: number;
    /** Whether the window opening at the destination posts it, as against a move from before. */
    fromWindow: boolean;
};

function postedAfter(candidate: PostedController, held: PostedController): boolean {
    return (
        (candidate.sampleFrame - held.sampleFrame ||
            candidate.sameFrameRank - held.sameFrameRank ||
            candidate.clipIndex - held.clipIndex ||
            candidate.rowIndex - held.rowIndex) > 0
    );
}

/**
 * What a track's stored controllers must send when playback is relocated to
 * `atBeat` (a loop wrap, a follow-action jump or an edit's re-emit), which the
 * window opening there cannot: it carries a lane's value only on a pass head, so a
 * destination inside a pass would otherwise leave every controller wherever playback
 * came from.
 *
 * The oracle is continuous playback, which is also what a DAW's chase does: the value
 * a controller holds at the destination is the one it would hold had playback run through
 * the track to get there, so it is the controller's last move posted up to the destination
 * frame, across every pass of every clip. A pass head that carries nothing (no row
 * precedes its visible span) leaves the value the previous pass ended on, and a clip
 * that starts after a clip left a controller set, without a row of its own for it,
 * leaves it set.
 *
 * "Last" is the order the window posts in: by sample frame, then the moves of a clip on
 * the frame its closing-line move plays on ahead of other clips' moves of that frame,
 * then clip sequence, then the clip's own row order, never by float beat. Two moves a
 * rounding step apart in beat share a frame, and which one the instrument ends on is the
 * clip order, so a restore that ordered them by beat would end on the other one. A clip's
 * closing-line move and the head of the clip that starts there share a frame too, and the
 * starting clip has the last word whatever the clip order; the closing clip's own earlier
 * moves on that frame keep their place ahead of its closing move, as the export does.
 *
 * A controller is one value per instrument: the instruments take the controller number
 * and drop the channel, so a controller is keyed by number alone. A row on any channel
 * is the last word on it.
 *
 * Nothing here places a beat itself. Every event comes from
 * `projectClipControllerEvents`, the projection the window emits through, so a
 * rounding step that moves a row across the destination moves it identically here
 * and there.
 *
 * - A controller whose last move is one the window opening at the destination posts
 *   (on the destination's frame, from any clip on any channel) is left to the window, so
 *   each value is sent once, and counts as in force. A closing-line move exactly on the
 *   destination is not one: the window opening there does not schedule the clip it ends.
 * - Every other controller with a move before the destination is in `moves`, placed at
 *   `atBeat`: the restore posts after the window does, so on the destination's frame it is
 *   the last word. An event later in the window does not touch the value in force now.
 */
export function projectClipControllerRestore({
    clips,
    atBeat,
    windowToBeat,
    sampleFrameAtBeat,
}: ProjectClipControllerRestoreInput): ClipControllerRestore {
    const destinationFrame = sampleFrameAtBeat(atBeat);
    const last = new Map<number, PostedController>();
    for (const [clipIndex, { clip, controlChanges }] of clips.entries()) {
        const events = projectClipControllerEvents({
            controlChanges,
            clip,
            // From the first pass, however a rounding step places its head against the clip
            // start: a head placed just before it is still where playback began.
            fromBeat: Number.NEGATIVE_INFINITY,
            toBeat: windowToBeat,
        });
        const closingMove = events.find((event) => event.closesClip);
        const closingFrame = closingMove ? sampleFrameAtBeat(closingMove.beat) : undefined;
        for (const [rowIndex, event] of events.entries()) {
            const sampleFrame = sampleFrameAtBeat(event.beat);
            if (sampleFrame > destinationFrame) {
                continue;
            }
            const candidate = {
                event,
                sampleFrame,
                sameFrameRank: sampleFrame === closingFrame ? 0 : 1,
                clipIndex,
                rowIndex,
                fromWindow: event.closesClip ? event.beat > atBeat : event.beat >= atBeat,
            };
            const held = last.get(event.controller);
            if (!held || postedAfter(candidate, held)) {
                last.set(event.controller, candidate);
            }
        }
    }

    const held = new Set<number>();
    const moves: MidiCC[] = [];
    for (const [controller, posted] of last) {
        held.add(controller);
        if (!posted.fromWindow) {
            const { id, value, channel } = posted.event;
            moves.push({ id, controller, value, channel, beat: atBeat });
        }
    }
    return { moves, held };
}
