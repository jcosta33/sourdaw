import { type MidiCC } from '../../models/MidiNote';

import { projectClipControllerEvents } from './projectClipControllerEvents';

type ControllerRestoreClip = Parameters<typeof projectClipControllerEvents>[0]['clip'];

type ProjectClipControllerRestoreInput = {
    controlChanges: readonly MidiCC[];
    clip: ControllerRestoreClip;
    /** The timeline beat playback has just been relocated to, where the window `[atBeat, windowToBeat)` opens. */
    atBeat: number;
    windowToBeat: number;
    /** Whether a timeline beat falls on the sample frame the destination does: the window's own notion of "at the same time". */
    onDestinationFrame: (beat: number) => boolean;
};

type ClipControllerRestore = {
    /** The value in force at `atBeat` for each lane the scheduler window opening there does not emit itself, placed at `atBeat`. */
    moves: MidiCC[];
    /** Every controller number that has a value in force at `atBeat`, whether `moves` carries it or the window opening there does. */
    held: ReadonlySet<number>;
};

function laneKey(row: MidiCC): string {
    return `${row.channel}:${row.controller}`;
}

/**
 * What a clip's stored controllers must send when playback is relocated to
 * `atBeat` (a loop wrap, a follow-action jump or an edit's re-emit), which the
 * window opening there cannot: it carries a lane's value only on a pass head, so a
 * destination inside a pass would otherwise leave every controller wherever playback
 * came from.
 *
 * The oracle is continuous playback: the value a lane holds at the destination is
 * the one it would hold had playback run through the clip to get there, so it is
 * the lane's last event, across every pass, before the destination. A pass whose
 * head carries nothing (no row of the lane precedes its visible span) leaves the
 * value the previous pass ended on, exactly as it does when played through.
 *
 * Nothing here places a beat itself. Every event comes from
 * `projectClipControllerEvents`, the projection the window emits through, so a
 * rounding step that moves a row across the destination moves it identically here
 * and there, and "at the same time as the destination" is the caller's sample-frame
 * comparison, not a beat comparison.
 *
 * - The carried value of a lane is its last event before the destination, a
 *   same-beat tie going to the later pass and then the later source row.
 * - A lane with a window event on the destination's frame is left to the window, so
 *   each value is sent once, and counts as in force.
 * - Every other lane with a carried value is in `moves`, placed at `atBeat`. An event
 *   later in the window does not touch the lane's value in force now.
 *
 * A destination outside the clip yields nothing.
 */
export function projectClipControllerRestore({
    controlChanges,
    clip,
    atBeat,
    windowToBeat,
    onDestinationFrame,
}: ProjectClipControllerRestoreInput): ClipControllerRestore {
    const none: ClipControllerRestore = { moves: [], held: new Set() };
    if (controlChanges.length === 0 || atBeat < clip.startBeat || atBeat >= clip.endBeat) {
        return none;
    }
    const events = projectClipControllerEvents({
        controlChanges,
        clip,
        // From the first pass, however a rounding step places its head against the clip
        // start: a head placed just before it is still where playback began.
        fromBeat: Number.NEGATIVE_INFINITY,
        toBeat: windowToBeat,
    });

    const lanesOnDestination = new Set<string>();
    const carried = new Map<string, MidiCC>();
    for (const event of events) {
        if (event.beat < atBeat) {
            carried.set(laneKey(event), event);
        } else if (onDestinationFrame(event.beat)) {
            lanesOnDestination.add(laneKey(event));
        }
    }

    const held = new Set<number>();
    const moves: MidiCC[] = [];
    for (const [lane, event] of carried) {
        held.add(event.controller);
        if (!lanesOnDestination.has(lane)) {
            moves.push({ ...event, beat: atBeat });
        }
    }
    for (const event of events) {
        if (lanesOnDestination.has(laneKey(event))) {
            held.add(event.controller);
        }
    }
    return { moves, held };
}
