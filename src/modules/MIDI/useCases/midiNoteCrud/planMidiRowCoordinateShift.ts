import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';

type RowKind = 'note' | 'cc' | 'pitchBend';

type CoordinateChange = {
    kind: RowKind;
    id: string;
    beforeBeat: number;
    afterBeat: number;
};

type CoordinateCapture = {
    beatDelta: number;
    coordinates: CoordinateChange[];
};

type Input = {
    notes: readonly Pick<MidiNote, 'id' | 'startBeat'>[];
    controllers: readonly Pick<MidiCC, 'id' | 'beat'>[];
    pitchBends: readonly Pick<MidiPitchBend, 'id' | 'beat'>[];
    beatDelta: number;
    restore?: unknown;
};

type Result =
    | { status: 'planned'; capture: CoordinateCapture }
    | { status: 'refused'; reason: 'invalid-delta' | 'invalid-row' | 'invalid-capture' | 'coordinate-overflow' };

function isIdentity(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isRowKind(value: unknown): value is RowKind {
    return value === 'note' || value === 'cc' || value === 'pitchBend';
}

function isFiniteBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function shiftedBeat(beat: number, delta: number): number {
    return delta === 0 ? beat : beat + delta;
}

function isCoherentChange(before: number, after: number, delta: number): boolean {
    const forward = shiftedBeat(before, delta);
    const reverse = shiftedBeat(after, -delta);
    // An exact restoration can be the reciprocal of a rounded forward sum.
    return (
        Number.isFinite(forward) &&
        Number.isFinite(reverse) &&
        (Object.is(after, forward) || Object.is(before, reverse))
    );
}

function readCapture(value: unknown, inverseDelta: number): Map<string, CoordinateChange> | null {
    if (
        value === null ||
        typeof value !== 'object' ||
        Object.keys(value).length !== 2 ||
        !('beatDelta' in value) ||
        !isFiniteBeat(value.beatDelta) ||
        value.beatDelta !== -inverseDelta ||
        !('coordinates' in value) ||
        !Array.isArray(value.coordinates)
    ) {
        return null;
    }
    const changes = new Map<string, CoordinateChange>();
    const entries: unknown[] = value.coordinates;
    for (const entry of entries) {
        if (
            entry === null ||
            typeof entry !== 'object' ||
            Object.keys(entry).length !== 4 ||
            !('kind' in entry) ||
            !isRowKind(entry.kind) ||
            !('id' in entry) ||
            !isIdentity(entry.id) ||
            !('beforeBeat' in entry) ||
            !isFiniteBeat(entry.beforeBeat) ||
            !('afterBeat' in entry) ||
            !isFiniteBeat(entry.afterBeat) ||
            !isCoherentChange(entry.beforeBeat, entry.afterBeat, value.beatDelta)
        ) {
            return null;
        }
        const key = `${entry.kind}:${entry.id}`;
        if (changes.has(key)) {
            return null;
        }
        changes.set(key, {
            kind: entry.kind,
            id: entry.id,
            beforeBeat: entry.beforeBeat,
            afterBeat: entry.afterBeat,
        });
    }
    return changes;
}

/** Plans coordinate writes only; the owner must apply the complete plan atomically. */
export function planMidiRowCoordinateShift(input: Input): Result {
    if (!isFiniteBeat(input.beatDelta)) {
        return { status: 'refused', reason: 'invalid-delta' };
    }
    const restored = input.restore === undefined ? undefined : readCapture(input.restore, input.beatDelta);
    if (restored === null) {
        return { status: 'refused', reason: 'invalid-capture' };
    }
    const coordinates: CoordinateChange[] = [];
    const identities = new Set<string>();
    const rows = [
        ...input.notes.map((row) => ({ kind: 'note' as const, id: row?.id, beat: row?.startBeat })),
        ...input.controllers.map((row) => ({ kind: 'cc' as const, id: row?.id, beat: row?.beat })),
        ...input.pitchBends.map((row) => ({ kind: 'pitchBend' as const, id: row?.id, beat: row?.beat })),
    ];
    for (const row of rows) {
        const key = `${row.kind}:${row.id}`;
        if (!isIdentity(row.id) || !isFiniteBeat(row.beat) || identities.has(key)) {
            return { status: 'refused', reason: 'invalid-row' };
        }
        identities.add(key);
        const translated = shiftedBeat(row.beat, input.beatDelta);
        if (!Number.isFinite(translated)) {
            return { status: 'refused', reason: 'coordinate-overflow' };
        }
        const captured = restored?.get(key);
        // A peer-moved row follows today's translation; only an unchanged coordinate restores its saved number.
        const afterBeat = captured && Object.is(row.beat, captured.afterBeat) ? captured.beforeBeat : translated;
        coordinates.push({ kind: row.kind, id: row.id, beforeBeat: row.beat, afterBeat });
    }
    return { status: 'planned', capture: { beatDelta: input.beatDelta, coordinates } };
}
