import {
    MIDI_EXPRESSION_DIMENSIONS,
    type MidiExpressionDimension,
    type MidiExpressionPoint,
    type MidiNote,
    type MidiNoteExpression,
} from '../../models/MidiNote';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

function scaleJoinedValue(
    note: MidiNote,
    dimension: MidiExpressionDimension,
    value: number,
    bendRange?: number
): number {
    if (dimension === 'pitchBend' && bendRange !== undefined) {
        if (bendRange === 0) {
            return 0;
        }
        return (value * (note.pitchBendRangeSemitones ?? 48)) / bendRange;
    }
    return value;
}

function neutralValue(dimension: MidiExpressionDimension): number {
    return dimension === 'slide' ? 64 : 0;
}

function joinedOnsetEvent(
    note: MidiNote,
    first: MidiNote,
    dimension: MidiExpressionDimension,
    priorEvents: readonly MidiExpressionPoint[],
    duration: number,
    bendRange?: number
): MidiExpressionPoint | undefined {
    const offsetBeats = note.startBeat - first.startBeat;
    if (offsetBeats <= 0 || offsetBeats >= duration) {
        return undefined;
    }
    const value = scaleJoinedValue(note, dimension, note[dimension] ?? neutralValue(dimension), bendRange);
    const previousValue =
        priorEvents.at(-1)?.value ??
        scaleJoinedValue(first, dimension, first[dimension] ?? neutralValue(dimension), bendRange);
    if (note[dimension] === undefined && previousValue === value) {
        return undefined;
    }
    return { offsetBeats, value };
}

function joinedDimensionCurve(
    notes: readonly MidiNote[],
    dimension: MidiExpressionDimension,
    duration: number,
    bendRange?: number
): MidiExpressionPoint[] {
    const first = notes[0]!;
    const events: MidiExpressionPoint[] = [];
    for (let index = 0; index < notes.length; index += 1) {
        const note = notes[index]!;
        const nextStart = notes[index + 1]?.startBeat ?? Infinity;
        const onset = index > 0 ? joinedOnsetEvent(note, first, dimension, events, duration, bendRange) : undefined;
        if (onset) {
            events.push(onset);
        }
        for (const point of note.expression?.[dimension] ?? []) {
            const absoluteBeat = note.startBeat + point.offsetBeats;
            // With tolerated overlap, the later note owns the expression
            // from its start. With a gap, the earlier value holds.
            if (absoluteBeat >= nextStart) {
                continue;
            }
            const offsetBeats = absoluteBeat - first.startBeat;
            if (offsetBeats <= 0 || offsetBeats >= duration) {
                continue;
            }
            events.push({ offsetBeats, value: scaleJoinedValue(note, dimension, point.value, bendRange) });
        }
    }
    // Re-basing can round neighbours onto one offset; the later value wins.
    const curve: MidiExpressionPoint[] = [];
    for (const point of events.sort((a, b) => a.offsetBeats - b.offsetBeats)) {
        const previous = curve.at(-1);
        if (previous && previous.offsetBeats >= point.offsetBeats) {
            curve[curve.length - 1] = point;
        } else {
            curve.push(point);
        }
    }
    return curve;
}

function joinedExpression(
    notes: readonly MidiNote[],
    duration: number
): Pick<MidiNote, MidiExpressionDimension | 'expression' | 'pitchBendRangeSemitones'> {
    const first = notes[0]!;
    const result: Pick<MidiNote, MidiExpressionDimension | 'expression' | 'pitchBendRangeSemitones'> = {};
    const expression: MidiNoteExpression = {};
    const hasBend = notes.some((note) => note.pitchBend !== undefined || note.expression?.pitchBend !== undefined);
    const bendRange = hasBend ? Math.max(...notes.map((note) => note.pitchBendRangeSemitones ?? 48)) : undefined;
    if (bendRange !== undefined) {
        result.pitchBendRangeSemitones = bendRange;
    }

    for (const dimension of MIDI_EXPRESSION_DIMENSIONS) {
        if (first[dimension] !== undefined) {
            result[dimension] = scaleJoinedValue(first, dimension, first[dimension], bendRange);
        }
        const curve = joinedDimensionCurve(notes, dimension, duration, bendRange);
        if (curve.length > 0) {
            expression[dimension] = curve;
        }
    }
    if (Object.keys(expression).length > 0) {
        result.expression = expression;
    }
    return result;
}

/**
 * Merges adjacent selected notes on the same pitch into single notes (R-A6).
 *
 * Two notes are considered adjacent when the gap between the end of the first and
 * the start of the next is within a musically-meaningful tolerance — an eighth of
 * `gridSize`. A fixed sub-millibeat tolerance silently failed to merge notes after
 * humanize / quantize(strength<1), which leave residual timing jitter far larger
 * than 0.001 beats yet still perceptually adjacent. Velocity takes the first note's
 * value. Non-adjacent notes or notes on different pitches within the selection are
 * left unchanged.
 *
 * `gridSize` defaults to one beat (a quarter note in 4/4) when the caller has no
 * grid context.
 */
export function joinNotes(clipId: string, selectedIds: string[], gridSize: number = 1): void {
    if (selectedIds.length < 2) {
        return;
    }
    const idSet = new Set(selectedIds);

    // Tolerate gaps up to an eighth of the grid: large enough to absorb humanize /
    // partial-quantize jitter, small enough not to swallow a genuine rest.
    const adjacencyTolerance = Math.abs(gridSize) / 8;

    updateNotesForClip(clipId, (notes) => {
        const selected = notes.filter((node) => idSet.has(node.id));

        // Group by pitch
        const byPitch = new Map<number, MidiNote[]>();
        for (const note of selected) {
            const group = byPitch.get(note.pitch) ?? [];
            group.push(note);
            byPitch.set(note.pitch, group);
        }

        const toRemove = new Set<string>();
        const toAdd: MidiNote[] = [];

        for (const [, group] of byPitch) {
            const sorted = [...group].sort((alpha, b) => alpha.startBeat - b.startBeat);

            let index = 0;
            while (index < sorted.length) {
                let jIndex = index;
                // Extend the run while notes are adjacent (end of j meets start of j+1)
                while (
                    jIndex + 1 < sorted.length &&
                    Math.abs(sorted[jIndex]!.startBeat + sorted[jIndex]!.duration - sorted[jIndex + 1]!.startBeat) <=
                        adjacencyTolerance
                ) {
                    jIndex++;
                }

                if (jIndex > index) {
                    // Merge notes i..j into one
                    const first = sorted[index]!;
                    const joined = sorted.slice(index, jIndex + 1);
                    const duration =
                        Math.max(...joined.map((note) => note.startBeat + note.duration)) - first.startBeat;
                    const { expression: _originalExpression, ...base } = first;
                    toAdd.push({
                        ...base,
                        duration,
                        ...joinedExpression(joined, duration),
                    });
                    for (let kIndex = index; kIndex <= jIndex; kIndex++) {
                        toRemove.add(sorted[kIndex]!.id);
                    }
                }
                index = jIndex + 1;
            }
        }

        if (toRemove.size === 0) {
            return notes;
        }

        return [...notes.filter((node) => !toRemove.has(node.id)), ...toAdd];
    });
}
