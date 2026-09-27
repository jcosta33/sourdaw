import { MAX_MIDI_DATA_7BIT, PITCH_BEND_MAX, PITCH_BEND_MIN } from '#/utils/midiData';

/** One change of a per-note expression dimension, `offsetBeats` after the note's `startBeat`. */
export type MidiExpressionPoint = {
    offsetBeats: number;
    value: number;
};

/**
 * Per-note expression recorded after note-on, one curve per dimension.
 *
 * The note's own scalar (`pressure`, `slide`, `pitchBend`) is the value in
 * effect at note-on; a curve holds only the changes after it. Every point's
 * `offsetBeats` is relative to the note's `startBeat`, finite, strictly inside
 * the note (`0 < offsetBeats < duration`) and strictly increasing. Values are
 * finite and in the scalar's own range and units: pressure and slide 0..127,
 * pitchBend the same raw 14-bit wire delta the scalar holds, read under the
 * note's `pitchBendRangeSemitones`.
 *
 * The value at an offset is the last point at or before it, else the scalar
 * (MIDI step semantics). An empty curve is omitted, never stored, and a note
 * without `expression` simply has no changes after note-on.
 */
export type MidiNoteExpression = {
    pressure?: MidiExpressionPoint[];
    slide?: MidiExpressionPoint[];
    pitchBend?: MidiExpressionPoint[];
};

export type MidiExpressionDimension = keyof MidiNoteExpression;

export const MIDI_EXPRESSION_DIMENSIONS = [
    'pressure',
    'slide',
    'pitchBend',
] as const satisfies readonly MidiExpressionDimension[];

const EXPRESSION_POINT_KEYS = ['offsetBeats', 'value'] as const;

export type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /**
     * Semitone range `pitchBend` was performed against (audit MD-8).
     *
     * `pitchBend` is the raw 14-bit wire delta and carries no depth of its own:
     * -4096 means one thing on a controller set to ±2 and something twelve
     * times deeper on one set to ±48. Recording the range alongside it is what
     * makes playback sound at the depth it was played.
     *
     * Optional, and absent means the MPE member default of ±48 semitones —
     * which is exactly what every recording made before RPN 0 was decoded was
     * captured under, so existing notes keep sounding as they always have.
     */
    pitchBendRangeSemitones?: number;
    channel?: number;
    /** Per-note performance articulation (for example staccato, accent, or legato). */
    articulation?: string;
    /** Expression changes after note-on; see `MidiNoteExpression`. */
    expression?: MidiNoteExpression;
};

export const MIDI_NOTE_REQUIRED_KEYS = ['id', 'pitch', 'startBeat', 'duration', 'velocity'] as const;
export const MIDI_NOTE_OPTIONAL_KEYS = [
    'probability',
    'pressure',
    'slide',
    'pitchBend',
    'pitchBendRangeSemitones',
    'channel',
    'articulation',
    'expression',
] as const;

export type MidiCC = {
    id: string;
    controller: number;
    value: number;
    beat: number;
    channel: number;
};

export type MidiPitchBend = {
    id: string;
    value: number;
    beat: number;
    channel: number;
};

export function isValidMidiArticulation(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value !== value.trim()) {
        return false;
    }
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
            return false;
        }
    }
    return true;
}

function isExpressionValueInRange(dimension: MidiExpressionDimension, value: number): boolean {
    if (dimension === 'pitchBend') {
        return value >= PITCH_BEND_MIN && value <= PITCH_BEND_MAX;
    }
    return value >= 0 && value <= MAX_MIDI_DATA_7BIT;
}

function hasExactOwnKeys(value: object, keys: readonly string[]): boolean {
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === 'string' && keys.includes(key));
}

function isExpressionPoint(dimension: MidiExpressionDimension, value: unknown): value is MidiExpressionPoint {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!hasExactOwnKeys(value, EXPRESSION_POINT_KEYS)) {
        return false;
    }
    const offsetBeats: unknown = Reflect.get(value, 'offsetBeats');
    const pointValue: unknown = Reflect.get(value, 'value');
    return (
        typeof offsetBeats === 'number' &&
        Number.isFinite(offsetBeats) &&
        typeof pointValue === 'number' &&
        Number.isFinite(pointValue) &&
        isExpressionValueInRange(dimension, pointValue)
    );
}

/**
 * Whether `value` is a stored curve for `dimension` on a note lasting
 * `duration` beats: a non-empty array of exact points, strictly increasing,
 * every offset strictly inside the note.
 */
export function isValidMidiExpressionCurve(
    dimension: MidiExpressionDimension,
    value: unknown,
    duration: number
): value is MidiExpressionPoint[] {
    if (!Array.isArray(value) || value.length === 0) {
        return false;
    }
    let previousOffset = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
            return false;
        }
        const point: unknown = value[index];
        if (!isExpressionPoint(dimension, point)) {
            return false;
        }
        if (point.offsetBeats <= previousOffset || point.offsetBeats >= duration) {
            return false;
        }
        previousOffset = point.offsetBeats;
    }
    return true;
}

/**
 * Whether `value` is a stored `MidiNote.expression` for a note lasting
 * `duration` beats: a plain object holding at least one valid curve and no
 * key other than the three dimensions.
 */
export function isValidMidiNoteExpression(value: unknown, duration: number): value is MidiNoteExpression {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length === 0) {
        return false;
    }
    return ownKeys.every(
        (key) =>
            typeof key === 'string' &&
            MIDI_EXPRESSION_DIMENSIONS.some(
                (dimension) =>
                    dimension === key && isValidMidiExpressionCurve(dimension, Reflect.get(value, dimension), duration)
            )
    );
}

export function createMidiNote(
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100,
    probability = 100
): MidiNote {
    return {
        id: `note-${crypto.randomUUID()}`,
        pitch,
        startBeat,
        duration,
        velocity,
        probability,
    };
}

export function createMidiCC(controller: number, value: number, beat: number, channel = 0): MidiCC {
    return {
        id: `cc-${crypto.randomUUID()}`,
        controller,
        value,
        beat,
        channel,
    };
}

export function createMidiPitchBend(value: number, beat: number, channel = 0): MidiPitchBend {
    return {
        id: `pb-${crypto.randomUUID()}`,
        value,
        beat,
        channel,
    };
}
