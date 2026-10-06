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
 * `atBeat` (a loop wrap or a follow-action jump), which a scheduler window opening
 * there cannot: `projectClipControllerEvents` emits a carry only on a pass head, so
 * a destination inside a pass would otherwise leave every controller wherever the
 * pass playback left them.
 *
 * `moves` is, per lane, the value in force at the destination by the same carry
 * rule a pass head uses: the latest row before it within that pass, a same-beat tie
 * going to the later source row. A lane with a row exactly on the destination is
 * left to the window that opens there, which emits that row, so each value is sent
 * once. A destination on a pass head is likewise owned by the window (it carries the
 * head), so `moves` is empty there, but `held` still names what the head holds, for
 * the caller to tell which engaged controllers nothing is in force for.
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
    const iteration = loopPassAt(clip, expansion, atBeat);
    const iterationStartBeat = clip.startBeat + iteration * expansion.loopLengthBeats;
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    const contentBeat = midiOffsetBeats + (atBeat - iterationStartBeat);

    const lanesOnDestination = new Set<string>();
    const held = new Set<number>();
    for (const row of controlChanges) {
        if (row.beat === contentBeat) {
            lanesOnDestination.add(laneKey(row));
            held.add(row.controller);
        }
    }
    // A window that has no visible span carries every row before its start and
    // emits none, which is exactly the value in force at the destination.
    const carried = projectMidiClipWindow({
        notes: [],
        controlChanges,
        pitchBends: [],
        window: { beatOffset: atBeat - contentBeat, visibleStartBeat: contentBeat, visibleEndBeat: contentBeat },
    }).controlChanges.filter((row) => !lanesOnDestination.has(laneKey(row)));
    for (const row of carried) {
        held.add(row.controller);
    }

    const onPassHead = atBeat <= iterationStartBeat;
    return { moves: onPassHead ? [] : carried.map((row) => ({ ...row, beat: atBeat })), held };
}
