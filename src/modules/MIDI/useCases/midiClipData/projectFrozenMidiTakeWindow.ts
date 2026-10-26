import { type MidiClipDataActionSnapshot } from '#/utils/handlerContract';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';

import { isExactMidiClipDataActionSnapshot } from './isExactMidiClipDataActionSnapshot';
import { projectMidiClipWindow } from './projectMidiClipWindow';

export type FrozenMidiTakeSource = {
    readonly sourceClipId: string;
    readonly rows: MidiClipDataActionSnapshot;
    readonly sourceEntryBeat: number;
    readonly sourceEndBeat: number;
    readonly phaseHeadBeat: number;
    readonly passLengthBeats: number;
};

type ProjectFrozenMidiTakeWindowInput = {
    readonly source: FrozenMidiTakeSource;
    readonly absoluteOccurrenceIndex: number;
    readonly fromBeat: number;
    readonly toBeat: number;
};

export type FrozenMidiTakeWindow = {
    readonly sourceClipId: string;
    readonly absoluteOccurrenceIndex: number;
    readonly notes: readonly MidiNote[];
    readonly controlChanges: readonly MidiCC[];
    readonly closingControlChanges: readonly MidiCC[];
    readonly pitchBends: readonly MidiPitchBend[];
};

function isFiniteBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** Presence is authoritative: an absent legacy source is handled by the caller. */
export function isFrozenMidiTakeSource(value: unknown): value is FrozenMidiTakeSource {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const keys = Reflect.ownKeys(value);
    const allowed = ['sourceClipId', 'rows', 'sourceEntryBeat', 'sourceEndBeat', 'phaseHeadBeat', 'passLengthBeats'];
    if (keys.length !== allowed.length || !keys.every((key) => typeof key === 'string' && allowed.includes(key))) {
        return false;
    }
    if (!('sourceClipId' in value) || typeof value.sourceClipId !== 'string' || value.sourceClipId.length === 0) {
        return false;
    }
    if (!('rows' in value) || !isExactMidiClipDataActionSnapshot(value.rows)) {
        return false;
    }
    if (
        !('sourceEntryBeat' in value) ||
        !isFiniteBeat(value.sourceEntryBeat) ||
        !('sourceEndBeat' in value) ||
        !isFiniteBeat(value.sourceEndBeat) ||
        value.sourceEndBeat <= value.sourceEntryBeat ||
        !('phaseHeadBeat' in value) ||
        !isFiniteBeat(value.phaseHeadBeat) ||
        !('passLengthBeats' in value) ||
        !isFiniteBeat(value.passLengthBeats) ||
        value.passLengthBeats <= 0
    ) {
        return false;
    }
    return value.sourceEndBeat - value.sourceEntryBeat <= value.passLengthBeats;
}

/**
 * One original pass occurrence in one timeline window. The existing MIDI
 * window projection clips notes and expression and carries controllers at a
 * fragment head; this call never makes a second stored row with the same id.
 */
export function projectFrozenMidiTakeWindow({
    source,
    absoluteOccurrenceIndex,
    fromBeat,
    toBeat,
}: ProjectFrozenMidiTakeWindowInput): FrozenMidiTakeWindow | null {
    if (
        !isFrozenMidiTakeSource(source) ||
        !Number.isSafeInteger(absoluteOccurrenceIndex) ||
        !isFiniteBeat(fromBeat) ||
        !isFiniteBeat(toBeat) ||
        fromBeat >= toBeat
    ) {
        return null;
    }
    const empty: FrozenMidiTakeWindow = {
        sourceClipId: source.sourceClipId,
        absoluteOccurrenceIndex,
        notes: [],
        controlChanges: [],
        closingControlChanges: [],
        pitchBends: [],
    };
    const passHeadBeat = source.phaseHeadBeat + absoluteOccurrenceIndex * source.passLengthBeats;
    const sourcePassEndBeat = passHeadBeat + source.sourceEndBeat - source.sourceEntryBeat;
    const visibleStartBeat = Math.max(fromBeat, passHeadBeat);
    const visibleEndBeat = Math.min(toBeat, sourcePassEndBeat);
    if (visibleStartBeat >= visibleEndBeat) {
        return empty;
    }
    const visibleSourceStartBeat = source.sourceEntryBeat + visibleStartBeat - passHeadBeat;
    const visibleSourceEndBeat = source.sourceEntryBeat + visibleEndBeat - passHeadBeat;
    const projected = projectMidiClipWindow({
        notes: source.rows.notes.value,
        controlChanges: source.rows.controlChanges.value,
        pitchBends: source.rows.pitchBends.value,
        window: {
            beatOffset: passHeadBeat - source.sourceEntryBeat,
            visibleStartBeat: visibleSourceStartBeat,
            visibleEndBeat: visibleSourceEndBeat,
            ...(visibleEndBeat === sourcePassEndBeat ? { closingLineBeat: sourcePassEndBeat } : {}),
        },
    });
    return { ...empty, ...projected };
}
