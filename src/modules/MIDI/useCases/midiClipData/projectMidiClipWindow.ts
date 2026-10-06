import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { sliceMidiNoteExtent } from '../../services/sliceMidiNoteExtent';

type MidiClipWindow = {
    /** Added to every projected beat; places the window's content on the destination timeline. */
    beatOffset: number;
    /** Content beats `[visibleStartBeat, visibleEndBeat)` are what the clip plays for one pass. */
    visibleStartBeat: number;
    visibleEndBeat: number;
};

type ProjectMidiClipWindowInput = {
    notes: readonly MidiNote[];
    controlChanges: readonly MidiCC[];
    pitchBends: readonly MidiPitchBend[];
    window: MidiClipWindow;
};

type ControllerRow = { beat: number };

function projectVisibleNote(note: MidiNote, window: MidiClipWindow): MidiNote | null {
    if (!Number.isFinite(note.startBeat) || !Number.isFinite(note.duration) || note.duration < 0) {
        return null;
    }
    if (note.duration === 0) {
        if (note.startBeat < window.visibleStartBeat || note.startBeat >= window.visibleEndBeat) {
            return null;
        }
        return { ...note, startBeat: note.startBeat + window.beatOffset };
    }

    const clippedStartBeat = Math.max(note.startBeat, window.visibleStartBeat);
    const clippedEndBeat = Math.min(note.startBeat + note.duration, window.visibleEndBeat);
    if (clippedEndBeat <= clippedStartBeat) {
        return null;
    }
    return {
        ...sliceMidiNoteExtent(note, {
            fromOffset: clippedStartBeat - note.startBeat,
            duration: clippedEndBeat - clippedStartBeat,
        }),
        startBeat: clippedStartBeat + window.beatOffset,
    };
}

/**
 * The rows inside the window, rebased, in source order. Every lane whose value
 * in force at the window start was set by an earlier row begins with that value
 * at the window start, unless the lane has a row there already, so a pedal or
 * bend held into the window keeps sounding.
 */
function projectVisibleControllerRows<TRow extends ControllerRow>(
    rows: readonly TRow[],
    laneKey: (row: TRow) => string,
    window: MidiClipWindow
): TRow[] {
    const inForceAtStart = new Map<string, TRow>();
    const lanesStartingAtWindow = new Set<string>();
    const visible: TRow[] = [];

    for (const row of rows) {
        if (!Number.isFinite(row.beat)) {
            continue;
        }
        if (row.beat < window.visibleStartBeat) {
            const current = inForceAtStart.get(laneKey(row));
            if (!current || current.beat <= row.beat) {
                inForceAtStart.set(laneKey(row), row);
            }
            continue;
        }
        if (row.beat >= window.visibleEndBeat) {
            continue;
        }
        if (row.beat === window.visibleStartBeat) {
            lanesStartingAtWindow.add(laneKey(row));
        }
        visible.push({ ...row, beat: row.beat + window.beatOffset });
    }

    const carried: TRow[] = [];
    for (const [key, row] of inForceAtStart) {
        if (!lanesStartingAtWindow.has(key)) {
            carried.push({ ...row, beat: window.visibleStartBeat + window.beatOffset });
        }
    }

    return [...carried, ...visible];
}

/** What a MIDI clip plays for one pass through `window`: notes clipped to it, controllers carried into it. */
export function projectMidiClipWindow({ notes, controlChanges, pitchBends, window }: ProjectMidiClipWindowInput): {
    notes: MidiNote[];
    controlChanges: MidiCC[];
    pitchBends: MidiPitchBend[];
} {
    return {
        notes: notes.flatMap((note) => projectVisibleNote(note, window) ?? []),
        controlChanges: projectVisibleControllerRows(
            controlChanges,
            (row) => `${row.channel}:${row.controller}`,
            window
        ),
        pitchBends: projectVisibleControllerRows(pitchBends, (row) => `${row.channel}`, window),
    };
}
