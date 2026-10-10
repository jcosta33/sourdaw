import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';
import { sliceMidiNoteExtent } from '../../services/sliceMidiNoteExtent';

type MidiClipWindow = {
    /** Added to every projected beat; places the window's content on the destination timeline. */
    beatOffset: number;
    /** Content beats `[visibleStartBeat, visibleEndBeat)` are what the clip plays for one pass. */
    visibleStartBeat: number;
    visibleEndBeat: number;
    /**
     * Where a controller row on the closing line (`visibleEndBeat`) plays, on the destination
     * timeline, when the window ends where the clip does. Absent, the window ends on a loop seam
     * or a cut and the closing line belongs to whatever plays next: the row is dropped.
     */
    closingLineBeat?: number;
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
 * A row within float noise of the closing line is on it, however the window's end
 * was reached: `offset + (end - start)` misses `offset + length` by an ulp on starts
 * that are not dyadic fractions. Inside the window it would land on the next pass
 * head or clip, one ulp behind that head's own rows, where it would win the tie, so
 * it is never a visible row: it is dropped, or played where `closingLineBeat` says.
 */
function isAtOrPastVisibleEnd(beat: number, window: MidiClipWindow): boolean {
    return beat >= window.visibleEndBeat - SAME_BEAT_TOLERANCE;
}

function isOnClosingLine(beat: number, window: MidiClipWindow): boolean {
    return Math.abs(beat - window.visibleEndBeat) <= SAME_BEAT_TOLERANCE;
}

type ProjectedControllerRows<TRow> = {
    /** The rows the window plays from its start up to (not on) its closing line. */
    rows: TRow[];
    /** The rows on the closing line, placed at `closingLineBeat`; none when the window has no closing line of its own. */
    closing: TRow[];
};

/**
 * The rows inside the window, rebased, in source order. Every lane whose value
 * in force at the window start was set by an earlier row begins with that value
 * at the window start, unless the lane has a row there already, so a pedal or
 * bend held into the window keeps sounding.
 */
function projectVisibleControllerRows<TRow extends ControllerRow>(
    rows: readonly TRow[],
    laneKey: (row: TRow) => string,
    window: MidiClipWindow,
    closingLineBeat: number | undefined
): ProjectedControllerRows<TRow> {
    const inForceAtStart = new Map<string, TRow>();
    const lanesStartingAtWindow = new Set<string>();
    const visible: TRow[] = [];
    const closing: TRow[] = [];

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
        if (isAtOrPastVisibleEnd(row.beat, window)) {
            if (closingLineBeat !== undefined && isOnClosingLine(row.beat, window)) {
                closing.push({ ...row, beat: closingLineBeat });
            }
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

    return { rows: [...carried, ...visible], closing };
}

/**
 * What a MIDI clip plays for one pass through `window`: notes clipped to it, controllers
 * carried into it, and the controller rows on its closing line when it has one. Pitch-bend
 * rows on the closing line are always dropped; no route plays a stored bend lane.
 */
export function projectMidiClipWindow({ notes, controlChanges, pitchBends, window }: ProjectMidiClipWindowInput): {
    notes: MidiNote[];
    controlChanges: MidiCC[];
    closingControlChanges: MidiCC[];
    pitchBends: MidiPitchBend[];
} {
    const controllers = projectVisibleControllerRows(
        controlChanges,
        (row) => `${row.channel}:${row.controller}`,
        window,
        window.closingLineBeat
    );
    return {
        notes: notes.flatMap((note) => projectVisibleNote(note, window) ?? []),
        controlChanges: controllers.rows,
        closingControlChanges: controllers.closing,
        pitchBends: projectVisibleControllerRows(pitchBends, (row) => `${row.channel}`, window, undefined).rows,
    };
}
