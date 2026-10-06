import { type MidiCC } from '../../models/MidiNote';

import { projectClipControllerEvents } from './projectClipControllerEvents';

type ControllerRestoreClip = Parameters<typeof projectClipControllerEvents>[0]['clip'];

type ProjectClipControllerRestoreInput = {
    /**
     * Every clip of the track whose stored controllers play, in the order the window posts them (a later
     * clip wins a tie of beat). A clip need not span the destination: one before it still holds the value
     * its last row left.
     */
    clips: readonly { clip: ControllerRestoreClip; controlChanges: readonly MidiCC[] }[];
    /** The timeline beat playback has just been relocated to, where the window `[atBeat, windowToBeat)` opens. */
    atBeat: number;
    windowToBeat: number;
    /** Whether a timeline beat falls on the sample frame the destination does: the window's own notion of "at the same time". */
    onDestinationFrame: (beat: number) => boolean;
};

type ClipControllerRestore = {
    /** The value in force at `atBeat` for each controller the scheduler window opening there does not emit itself, placed at `atBeat`. */
    moves: MidiCC[];
    /** Every controller number that has a value in force at `atBeat`, whether `moves` carries it or the window opening there does. */
    held: ReadonlySet<number>;
};

/**
 * What a track's stored controllers must send when playback is relocated to
 * `atBeat` (a loop wrap, a follow-action jump or an edit's re-emit), which the
 * window opening there cannot: it carries a lane's value only on a pass head, so a
 * destination inside a pass would otherwise leave every controller wherever playback
 * came from.
 *
 * The oracle is continuous playback, which is also what a DAW's chase does: the value
 * a controller holds at the destination is the one it would hold had playback run
 * through the track to get there, so it is the controller's last event, across every
 * pass of every clip, before the destination. A pass head that carries nothing (no row
 * precedes its visible span) leaves the value the previous pass ended on, and a clip
 * that starts after a clip left a controller set, without a row of its own for it,
 * leaves it set.
 *
 * A controller is one value per instrument: the instruments take the controller number
 * and drop the channel, so a controller is keyed by number alone. A row on any channel
 * is the last word on it.
 *
 * Nothing here places a beat itself. Every event comes from
 * `projectClipControllerEvents`, the projection the window emits through, so a
 * rounding step that moves a row across the destination moves it identically here
 * and there, and "at the same time as the destination" is the caller's sample-frame
 * comparison, not a beat comparison.
 *
 * - The carried value of a controller is its last event before the destination, a
 *   same-beat tie going to the later clip and then the later source row.
 * - A controller with a window event on the destination's frame, from any clip on
 *   any channel, is left to the window, so each value is sent once, and counts as
 *   in force.
 * - Every other controller with a carried value is in `moves`, placed at `atBeat`.
 *   An event later in the window does not touch the value in force now.
 */
export function projectClipControllerRestore({
    clips,
    atBeat,
    windowToBeat,
    onDestinationFrame,
}: ProjectClipControllerRestoreInput): ClipControllerRestore {
    const onDestination = new Set<number>();
    const carried = new Map<number, MidiCC>();
    for (const { clip, controlChanges } of clips) {
        const events = projectClipControllerEvents({
            controlChanges,
            clip,
            // From the first pass, however a rounding step places its head against the clip
            // start: a head placed just before it is still where playback began.
            fromBeat: Number.NEGATIVE_INFINITY,
            toBeat: windowToBeat,
        });
        for (const event of events) {
            if (event.beat < atBeat) {
                const latest = carried.get(event.controller);
                if (!latest || event.beat >= latest.beat) {
                    carried.set(event.controller, event);
                }
            } else if (onDestinationFrame(event.beat)) {
                onDestination.add(event.controller);
            }
        }
    }

    const held = new Set<number>(onDestination);
    const moves: MidiCC[] = [];
    for (const [controller, event] of carried) {
        held.add(controller);
        if (!onDestination.has(controller)) {
            moves.push({ ...event, beat: atBeat });
        }
    }
    return { moves, held };
}
