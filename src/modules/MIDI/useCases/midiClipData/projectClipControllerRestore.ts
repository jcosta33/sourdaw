import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type MidiCC } from '../../models/MidiNote';

import { projectMidiClipWindow } from './projectMidiClipWindow';

type ControllerRestoreClip = {
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
};

type ProjectClipControllerRestoreInput = {
    controlChanges: readonly MidiCC[];
    clip: ControllerRestoreClip;
    /** The timeline beat playback has just been relocated to. */
    atBeat: number;
};

type ClipControllerRestore = {
    /** The value in force at `atBeat` for each lane the scheduler window opening there does not emit itself, placed at `atBeat`. */
    moves: MidiCC[];
    /** Every controller number that has a value in force at `atBeat`, whether `moves` carries it or the window opening there does. */
    held: ReadonlySet<number>;
};

/**
 * How far past `atBeat` a placed row may sit and still be on the destination: the
 * rounding noise between the window's arithmetic (`iterationStart - midiOffset`
 * added to a content beat) and the destination beat, at the beat magnitudes a song
 * reaches. Far below any musical distance and below a sample at any tempo.
 */
const DESTINATION_BEAT_TOLERANCE = 1e-9;

function laneKey(row: MidiCC): string {
    return `${row.channel}:${row.controller}`;
}

/** The index of the loop pass `atBeat` falls in; a clip that does not loop has exactly one. */
function loopPassAt(
    clip: ControllerRestoreClip,
    expansion: { iterationCount: number; loopLengthBeats: number },
    atBeat: number
): number {
    if (!clip.loopEnabled) {
        return 0;
    }
    return Math.min(expansion.iterationCount - 1, Math.floor((atBeat - clip.startBeat) / expansion.loopLengthBeats));
}

/**
 * What a clip's stored controllers must send when playback is relocated to
 * `atBeat` (a loop wrap, a follow-action jump or an edit's re-emit), which a
 * scheduler window opening there cannot: `projectClipControllerEvents` emits a
 * carry only on a pass head, so a destination inside a pass would otherwise leave
 * every controller wherever the pass playback left them.
 *
 * The pass is placed on the timeline by `projectMidiClipWindow`, the very projection
 * the window emits through, and every row is classified by where that placement puts
 * it, never by a second computation of the same beat: a content-beat comparison
 * disagrees with the window by a rounding step whenever the clip start or content
 * offset is not a dyadic fraction, which sent a stale carried value after the row
 * the window emits. A row placed at the destination (the window emits it, and a
 * pass head's carry is such a row) leaves its lane to the window, so each value is
 * sent once, and the lane counts as in force. A row placed before it is carried: per
 * lane the latest, a same-beat tie going to the later source row, sent as `moves`.
 * A row placed after the destination is the window's to emit when its time comes
 * and says nothing about what is in force now.
 *
 * A destination outside the clip yields nothing.
 */
export function projectClipControllerRestore({
    controlChanges,
    clip,
    atBeat,
}: ProjectClipControllerRestoreInput): ClipControllerRestore {
    const none: ClipControllerRestore = { moves: [], held: new Set() };
    if (controlChanges.length === 0 || atBeat < clip.startBeat || atBeat >= clip.endBeat) {
        return none;
    }
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const iterationStartBeat = clip.startBeat + loopPassAt(clip, expansion, atBeat) * expansion.loopLengthBeats;
    const iterationEndBeat = Math.min(iterationStartBeat + expansion.loopLengthBeats, clip.endBeat);
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    const placed = projectMidiClipWindow({
        notes: [],
        controlChanges,
        pitchBends: [],
        window: {
            beatOffset: iterationStartBeat - midiOffsetBeats,
            visibleStartBeat: midiOffsetBeats,
            visibleEndBeat: midiOffsetBeats + (iterationEndBeat - iterationStartBeat),
        },
    }).controlChanges;

    const lanesOnDestination = new Set<string>();
    const latestBefore = new Map<string, MidiCC>();
    for (const row of placed) {
        const lane = laneKey(row);
        if (row.beat >= atBeat) {
            if (row.beat - atBeat <= DESTINATION_BEAT_TOLERANCE) {
                lanesOnDestination.add(lane);
            }
            continue;
        }
        const current = latestBefore.get(lane);
        if (!current || current.beat <= row.beat) {
            latestBefore.set(lane, row);
        }
    }

    const held = new Set<number>();
    const moves: MidiCC[] = [];
    for (const [lane, row] of latestBefore) {
        if (lanesOnDestination.has(lane)) {
            continue;
        }
        held.add(row.controller);
        moves.push({ ...row, beat: atBeat });
    }
    for (const row of placed) {
        if (lanesOnDestination.has(laneKey(row))) {
            held.add(row.controller);
        }
    }
    return { moves, held };
}
