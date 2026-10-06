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
 * A lane no stored row can belong to. A row before a pass's visible span is carried
 * to the span's head by the projection, so one such row makes the projection place
 * a marker at every pass head, exactly where it places the carries: the pass the
 * destination is in is read off the projection, not worked out a second time.
 */
const PASS_HEAD_MARKER: MidiCC = { id: 'pass-head-marker', controller: -1, value: 0, beat: -1e9, channel: -1 };

/**
 * What a clip's stored controllers must send when playback is relocated to
 * `atBeat` (a loop wrap, a follow-action jump or an edit's re-emit), which the
 * window opening there cannot: it carries a lane's value only on a pass head, so a
 * destination inside a pass would otherwise leave every controller wherever playback
 * came from.
 *
 * Nothing here places a beat itself. Every event comes from
 * `projectClipControllerEvents`, the projection the window emits through, so a
 * rounding step that moves a row across the destination moves it identically here
 * and there, and "at the same time as the destination" is the caller's sample-frame
 * comparison, not a beat comparison.
 *
 * - The carried value of a lane is its last event before the destination within the
 *   pass the destination is in (a pass-head carry included, a same-beat tie going to
 *   the later source row). A destination that is itself a pass head, a marker on its
 *   frame, carries nothing: the window's own head carries and rows say it all.
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
        controlChanges: [...controlChanges, PASS_HEAD_MARKER],
        clip,
        // From the first pass, however a rounding step places its head against the clip
        // start: a head placed just before it is still the head the destination follows.
        fromBeat: Number.NEGATIVE_INFINITY,
        toBeat: windowToBeat,
    });

    const lanesOnDestination = new Set<string>();
    let destinationIsPassHead = false;
    let passHeadBeat = Number.NEGATIVE_INFINITY;
    for (const event of events) {
        const isMarker = event.controller === PASS_HEAD_MARKER.controller;
        if (event.beat < atBeat) {
            if (isMarker) {
                passHeadBeat = Math.max(passHeadBeat, event.beat);
            }
        } else if (onDestinationFrame(event.beat)) {
            if (isMarker) {
                destinationIsPassHead = true;
            } else {
                lanesOnDestination.add(laneKey(event));
            }
        }
    }

    const latestInPass = new Map<string, MidiCC>();
    if (!destinationIsPassHead) {
        for (const event of events) {
            if (event.controller !== PASS_HEAD_MARKER.controller && event.beat < atBeat && event.beat >= passHeadBeat) {
                latestInPass.set(laneKey(event), event);
            }
        }
    }

    const held = new Set<number>();
    const moves: MidiCC[] = [];
    for (const event of events) {
        if (event.controller !== PASS_HEAD_MARKER.controller && lanesOnDestination.has(laneKey(event))) {
            held.add(event.controller);
        }
    }
    for (const [lane, event] of latestInPass) {
        if (!lanesOnDestination.has(lane)) {
            held.add(event.controller);
            moves.push({ ...event, beat: atBeat });
        }
    }
    return { moves, held };
}
