import { MAX_MIDI_DATA_7BIT, PITCH_BEND_MAX, PITCH_BEND_MIN } from '#/utils/midiData';

import { getDefaultBendRangeSemitones } from './getDefaultBendRangeSemitones';
import { type ScheduledNoteExpression } from './noteExpressionTimeline';

function clampOptional(value: number | undefined, minimum: number, maximum: number): number | undefined {
    return value === undefined ? undefined : Math.min(maximum, Math.max(minimum, value));
}

/** The values as an engine takes them: each in its wire range, and a range only beside a bend. */
export function clampScheduledExpression(
    values: { pressure?: number; slide?: number; pitchBend?: number },
    recordedRangeSemitones: number | undefined
): ScheduledNoteExpression {
    const expression: ScheduledNoteExpression = {
        pressure: clampOptional(values.pressure, 0, MAX_MIDI_DATA_7BIT),
        slide: clampOptional(values.slide, 0, MAX_MIDI_DATA_7BIT),
        pitchBend: clampOptional(values.pitchBend, PITCH_BEND_MIN, PITCH_BEND_MAX),
    };
    if (values.pitchBend !== undefined) {
        expression.pitchBendRangeSemitones = clampOptional(
            recordedRangeSemitones ?? getDefaultBendRangeSemitones(),
            0,
            127
        );
    }
    return expression;
}
