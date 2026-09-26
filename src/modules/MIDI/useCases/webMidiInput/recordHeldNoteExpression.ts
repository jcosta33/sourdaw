import { type MidiExpressionDimension } from '../../models/MidiNote';
import { type ActiveNoteData, type HeldNoteExpressionTrail } from '../../models/WebMidiTypes';

/**
 * Most changes one dimension of one held note keeps. A note can be held
 * indefinitely while a controller streams pressure, so an unbounded trail
 * would grow the live note's memory and the stored CRDT note without limit.
 */
const MAX_HELD_EXPRESSION_POINTS = 4096;

type HeldNoteExpressionChange = {
    dimension: MidiExpressionDimension;
    value: number;
    eventTime: number;
};

function lastValue(trail: HeldNoteExpressionTrail): number | undefined {
    return trail.points.at(-1)?.value ?? trail.initial;
}

/**
 * Drops the oldest interior point once the trail is over its bound. The first
 * point keeps where the gesture began and the last the value now in effect,
 * so neither is ever the one dropped.
 */
function boundTrail(trail: HeldNoteExpressionTrail): void {
    if (trail.points.length > MAX_HELD_EXPRESSION_POINTS) {
        trail.points.splice(1, 1);
    }
}

/**
 * Records one MPE expression change on a held note, before the caller moves
 * the note's live scalar to `value`.
 *
 * A change at or before note-on is the note-on value itself: it is left to
 * the scalar, or replaces the captured note-on value once a trail exists.
 * A later change appends `{ seconds since note-on, value }` unless it repeats
 * the value already in effect. A change stamped no later than the trail's last
 * point replaces that point's value, so offsets stay strictly increasing.
 */
export function recordHeldNoteExpression(
    noteData: ActiveNoteData,
    { dimension, value, eventTime }: HeldNoteExpressionChange
): void {
    const offsetSeconds = eventTime - noteData.startTime;
    const trails = noteData.expressionTrails ?? {};
    const trail = trails[dimension];

    if (!(offsetSeconds > 0)) {
        if (trail !== undefined) {
            trail.initial = value;
        }
        return;
    }

    if (trail === undefined) {
        if (value === noteData[dimension]) {
            return;
        }
        trails[dimension] = { initial: noteData[dimension], points: [{ offsetSeconds, value }] };
        noteData.expressionTrails = trails;
        return;
    }

    if (value === lastValue(trail)) {
        return;
    }
    const last = trail.points.at(-1);
    if (last !== undefined && offsetSeconds <= last.offsetSeconds) {
        last.value = value;
        return;
    }
    trail.points.push({ offsetSeconds, value });
    boundTrail(trail);
}
