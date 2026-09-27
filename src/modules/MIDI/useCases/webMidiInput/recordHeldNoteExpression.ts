import { type MidiExpressionDimension } from '../../models/MidiNote';
import {
    type ActiveNoteData,
    type HeldNoteExpressionPoint,
    type HeldNoteExpressionTrail,
} from '../../models/WebMidiTypes';

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
    bendRangeSemitones?: number;
};

function lastPoint(trail: HeldNoteExpressionTrail): { value: number | undefined; bendRangeSemitones?: number } {
    const point = trail.points.at(-1);
    return point ?? { value: trail.initial, bendRangeSemitones: trail.initialBendRangeSemitones };
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
    { dimension, value, eventTime, bendRangeSemitones }: HeldNoteExpressionChange
): void {
    const offsetSeconds = eventTime - noteData.startTime;
    const trails = noteData.expressionTrails ?? {};
    const trail = trails[dimension];

    if (!(offsetSeconds > 0)) {
        if (trail !== undefined) {
            trail.initial = value;
            if (dimension === 'pitchBend') {
                trail.initialBendRangeSemitones = bendRangeSemitones;
            }
        }
        return;
    }

    if (trail === undefined) {
        if (
            value === noteData[dimension] &&
            (dimension !== 'pitchBend' || bendRangeSemitones === (noteData.pitchBendRangeSemitones ?? 48))
        ) {
            return;
        }
        const point: HeldNoteExpressionPoint = { offsetSeconds, value };
        if (bendRangeSemitones !== undefined) {
            point.bendRangeSemitones = bendRangeSemitones;
        }
        const nextTrail: HeldNoteExpressionTrail = { initial: noteData[dimension], points: [point] };
        if (dimension === 'pitchBend' && noteData[dimension] !== undefined) {
            nextTrail.initialBendRangeSemitones = noteData.pitchBendRangeSemitones ?? 48;
        }
        trails[dimension] = nextTrail;
        noteData.expressionTrails = trails;
        return;
    }

    const previous = lastPoint(trail);
    if (value === previous.value && bendRangeSemitones === previous.bendRangeSemitones) {
        return;
    }
    const last = trail.points.at(-1);
    if (last !== undefined && offsetSeconds <= last.offsetSeconds) {
        last.value = value;
        if (bendRangeSemitones !== undefined) {
            last.bendRangeSemitones = bendRangeSemitones;
        }
        return;
    }
    const point: HeldNoteExpressionPoint = { offsetSeconds, value };
    if (bendRangeSemitones !== undefined) {
        point.bendRangeSemitones = bendRangeSemitones;
    }
    trail.points.push(point);
    boundTrail(trail);
}
