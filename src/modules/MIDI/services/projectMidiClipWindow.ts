import { isPedalControllerLift } from '#/utils/pianoPedalController';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../models/SameBeatTolerance';

import { pitchBendLaneKey } from './pitchBendLaneKey';
import { isRegisteredParameterController } from './registeredParameterState';
import { sliceMidiNoteExtent } from './sliceMidiNoteExtent';

/** Source location belongs to a window projection, never to a stored bend row. */
export type MidiPitchBendWindowRow = MidiPitchBend & { readonly sourceRecordedBeat?: number };
export type SourceLocatedMidiPitchBend = MidiPitchBendWindowRow & { readonly sourceRecordedBeat: number };
/** The note's last own bend before a window cut, on the destination timeline. This is projection data only. */
export type MidiNoteWindowRow = MidiNote & { readonly recordedOwnBendBeat?: number };

type MidiClipWindow = {
    /** Added to every projected beat; places the window's content on the destination timeline. */
    beatOffset: number;
    /** Content beats `[visibleStartBeat, visibleEndBeat)` are what the clip plays for one pass. */
    visibleStartBeat: number;
    visibleEndBeat: number;
    /**
     * Where a pedal lift on the closing line (`visibleEndBeat`) plays, on the
     * destination timeline, when the window ends where the clip does. Absent, the window ends on a
     * loop seam or a cut and the closing line belongs to whatever plays next: the row is dropped.
     */
    closingLineBeat?: number;
    /**
     * Set when the loop played a whole pass before this window's start, so the window opens mid-loop on
     * material the previous pass already ran through: the content beat that pass ended on (the loop region
     * end). A controller lane no row before the window start sets begins with the value its last row before
     * that end left, as continuous looping holds it. Pitch-bend lanes do not read it.
     */
    priorPassEndBeat?: number;
};

type ProjectMidiClipWindowInput<TPitchBend extends MidiPitchBend> = {
    notes: readonly MidiNote[];
    controlChanges: readonly MidiCC[];
    /** Rebased, and carried to the window start, with every other field of the row kept as it is. */
    pitchBends: readonly TPitchBend[];
    window: MidiClipWindow;
    /** Preserve a frozen note's own bend chronology when its head is cropped and its curve is sliced. */
    locatesOwnBend?: boolean;
    /**
     * Whether the RPN/NRPN and Data Entry rows before the window start are carried into it like any other
     * lane, by their last value; true when absent. A caller that places the window's content beside other
     * content in one clip (glue) passes false and declares the state those rows leave instead
     * (`declareGluedRegisteredParameters`), because the last value of each of their lanes does not say it.
     */
    carriesRegisteredParameterLanes?: boolean;
};

type ControllerRow = { beat: number };

function lastOwnBendBeatAt(note: MidiNote, sourceBeat: number): number | undefined {
    let bendBeat = note.pitchBend === undefined ? undefined : note.startBeat;
    for (const point of note.expression?.pitchBend ?? []) {
        const pointBeat = note.startBeat + point.offsetBeats;
        if (pointBeat > sourceBeat) {
            break;
        }
        bendBeat = pointBeat;
    }
    return bendBeat;
}

function projectVisibleNote(note: MidiNote, window: MidiClipWindow, locatesOwnBend: boolean): MidiNoteWindowRow | null {
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
    const projected = {
        ...sliceMidiNoteExtent(note, {
            fromOffset: clippedStartBeat - note.startBeat,
            duration: clippedEndBeat - clippedStartBeat,
        }),
        startBeat: clippedStartBeat + window.beatOffset,
    };
    const bendBeat =
        locatesOwnBend && clippedStartBeat > note.startBeat ? lastOwnBendBeatAt(note, clippedStartBeat) : undefined;
    return bendBeat === undefined ? projected : { ...projected, recordedOwnBendBeat: bendBeat + window.beatOffset };
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

type CarriedRow<TRow> = { row: TRow; sourceIndex: number };

type ProjectedControllerRows<TRow> = {
    /**
     * The source rows whose values each lane carries onto the window start, at their own beats, in the order
     * continuous playback played them (`inPlaybackOrder`); `placeOnWindowStart` puts them there.
     */
    carried: TRow[];
    /** The rows inside the window, rebased, in source order, up to (not on) its closing line. */
    visible: TRow[];
    /** The rows on the closing line, placed at `closingLineBeat`; none when the window has no closing line of its own. */
    closing: TRow[];
};

type ControllerRowLaneRules<TRow> = {
    laneKey: (row: TRow) => string;
    closingLineBeat: number | undefined;
    /** Where the pass before the window ended, when one did (`MidiClipWindow.priorPassEndBeat`). */
    priorPassEndBeat: number | undefined;
    /** A row before the window that this refuses is left behind. */
    carriesIntoWindow: (row: TRow) => boolean;
};

/** Keeps the lane's latest row by beat; at one beat the later source row is the one the player ends on. */
function keepLatestRow<TRow extends ControllerRow>(
    latest: Map<string, CarriedRow<TRow>>,
    key: string,
    candidate: CarriedRow<TRow>
): void {
    const current = latest.get(key);
    if (!current || current.row.beat <= candidate.row.beat) {
        latest.set(key, candidate);
    }
}

/**
 * The rows inside the window, and the rows each lane carries onto its start: every lane whose value in force
 * at the window start was set by an earlier row begins with that value at the window start, unless the lane
 * has a row there already, so a pedal or bend held into the window keeps sounding. When a whole pass played
 * before the window, a lane no earlier row sets begins with the value that pass ended on instead: its last
 * row from the window start up to (not on) the pass's closing line, which an inner seam drops.
 */
function projectVisibleControllerRows<TRow extends ControllerRow>(
    rows: readonly TRow[],
    window: MidiClipWindow,
    { laneKey, closingLineBeat, priorPassEndBeat, carriesIntoWindow }: ControllerRowLaneRules<TRow>
): ProjectedControllerRows<TRow> {
    const inForceAtStart = new Map<string, CarriedRow<TRow>>();
    const inForceAtPriorPassEnd = new Map<string, CarriedRow<TRow>>();
    const lanesStartingAtWindow = new Set<string>();
    const visible: TRow[] = [];
    const closing: TRow[] = [];

    for (const [sourceIndex, row] of rows.entries()) {
        if (!Number.isFinite(row.beat)) {
            continue;
        }
        if (row.beat < window.visibleStartBeat) {
            if (carriesIntoWindow(row)) {
                keepLatestRow(inForceAtStart, laneKey(row), { row, sourceIndex });
            }
            continue;
        }
        if (
            priorPassEndBeat !== undefined &&
            row.beat < priorPassEndBeat - SAME_BEAT_TOLERANCE &&
            carriesIntoWindow(row)
        ) {
            keepLatestRow(inForceAtPriorPassEnd, laneKey(row), { row, sourceIndex });
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

    const carriedFromThisPass = [...inForceAtStart].flatMap(([key, carry]) =>
        lanesStartingAtWindow.has(key) ? [] : [carry]
    );
    const carriedFromPriorPass = [...inForceAtPriorPassEnd].flatMap(([key, carry]) =>
        inForceAtStart.has(key) || lanesStartingAtWindow.has(key) ? [] : [carry]
    );
    // The pass before played its rows before any row of this pass ahead of the window, so they go first.
    const carried = [...inPlaybackOrder(carriedFromPriorPass), ...inPlaybackOrder(carriedFromThisPass)];

    return { carried, visible, closing };
}

function placeOnWindowStart<TRow extends ControllerRow>(rows: readonly TRow[], window: MidiClipWindow): TRow[] {
    return rows.map((row) => ({ ...row, beat: window.visibleStartBeat + window.beatOffset }));
}

/**
 * The rows carried onto one window start all play on it, and the player ends on the last of them, so they keep
 * the order continuous playback played them in: a controller is one value per instrument whatever channel its
 * row names, and the later of a drawn bend row and a recorded wheel of one channel stays the one in force for
 * that channel's notes. Rows on one beat keep their source order, which is how the player breaks the tie on
 * the untrimmed clip (an MPE switch writes its rows on one beat).
 */
function inPlaybackOrder<TRow extends ControllerRow>(carried: readonly CarriedRow<TRow>[]): TRow[] {
    return carried
        .toSorted((left, right) => left.row.beat - right.row.beat || left.sourceIndex - right.sourceIndex)
        .map(({ row }) => row);
}

/**
 * Of the controller rows on a closing line, only a true pedal lift plays: it ends what
 * the clip held. A press there would hold past the clip end with nothing of the clip left
 * to hold, and any other row there would leave its value set for whatever follows — a
 * partial sustain among them, which lifts nothing — so every other row stays dropped.
 */
function playsOnClosingLine(row: MidiCC): boolean {
    return isPedalControllerLift(row.controller, row.value);
}

/**
 * What a MIDI clip plays for one pass through `window`: notes clipped to it, controllers
 * carried into it, and the pedal lifts on its closing line when it has one.
 * Pitch-bend rows on the closing line are always dropped: bend is a continuous position, not
 * a switch, so no row there ends anything (`projectClipPitchBendEvents` plays the lane).
 */
export function projectMidiClipWindow<TPitchBend extends MidiPitchBend>({
    notes,
    controlChanges,
    pitchBends,
    window,
    locatesOwnBend = false,
    carriesRegisteredParameterLanes = true,
}: ProjectMidiClipWindowInput<TPitchBend>): {
    notes: MidiNoteWindowRow[];
    controlChanges: MidiCC[];
    closingControlChanges: MidiCC[];
    pitchBends: TPitchBend[];
} {
    const controllers = projectVisibleControllerRows(controlChanges, window, {
        laneKey: (row) => `${row.channel}:${row.controller}`,
        closingLineBeat: window.closingLineBeat,
        priorPassEndBeat: window.priorPassEndBeat,
        carriesIntoWindow: (row) => carriesRegisteredParameterLanes || !isRegisteredParameterController(row.controller),
    });
    const bends = projectVisibleControllerRows(pitchBends, window, {
        laneKey: pitchBendLaneKey,
        closingLineBeat: undefined,
        priorPassEndBeat: undefined,
        carriesIntoWindow: () => true,
    });
    return {
        notes: notes.flatMap((note) => projectVisibleNote(note, window, locatesOwnBend) ?? []),
        controlChanges: [...placeOnWindowStart(controllers.carried, window), ...controllers.visible],
        closingControlChanges: controllers.closing.filter(playsOnClosingLine),
        pitchBends: [...placeOnWindowStart(bends.carried, window), ...bends.visible],
    };
}
