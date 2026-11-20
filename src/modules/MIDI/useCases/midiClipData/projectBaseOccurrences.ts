import { resolveClipLoopPassGrid } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type MidiNote } from '../../models/MidiNote';
import { projectClipMidiEvents } from '../grooveTemplates/projectClipMidiEvents';

import {
    type BaseGapPianoRollNoteOwner,
    type BaseOccurrence,
    type ClipPlacement,
    type QueryWindow,
} from './pianoRollProjectionTypes';

type QueryBudget = { charge: (amount: number) => void; emit: (amount: number) => void };

function appendEventOccurrences(
    {
        event,
        row,
        occurrenceIndex,
    }: { event: ReturnType<typeof projectClipMidiEvents>[number]; row: MidiNote; occurrenceIndex: number },
    {
        gaps,
        clip,
        base,
        window,
    }: {
        gaps: readonly { startBeat: number; endBeat: number }[];
        clip: ClipPlacement;
        base: { ownersByViewId: ReadonlyMap<string, BaseGapPianoRollNoteOwner> };
        window: QueryWindow;
    },
    occurrences: BaseOccurrence[]
): void {
    for (const gap of gaps) {
        const start = Math.max(event.startBeat, gap.startBeat);
        const end = Math.min(event.startBeat + event.duration, gap.endBeat);
        if (end <= start || start >= window.toBeat || end <= window.fromBeat) {
            continue;
        }
        let viewId = row.id;
        for (const [candidateViewId, candidate] of base.ownersByViewId) {
            const at = clip.startBeat + candidate.displayedStartBeat - (clip.midiOffsetBeats ?? 0);
            if (candidate.row.id === row.id && at < gap.endBeat && at + candidate.displayedDuration > gap.startBeat) {
                viewId = candidateViewId;
                break;
            }
        }
        occurrences.push({
            row,
            viewId,
            startBeat: start,
            duration: end - start,
            velocity: event.velocity,
            occurrenceIndex,
        });
    }
}

function uncoveredGaps(clip: ClipPlacement, covered: readonly { startBeat: number; endBeat: number }[]) {
    const gaps: { startBeat: number; endBeat: number }[] = [];
    let cursor = clip.startBeat;
    for (const region of [...covered].sort((a, b) => a.startBeat - b.startBeat)) {
        if (region.startBeat > cursor) {
            gaps.push({ startBeat: cursor, endBeat: region.startBeat });
        }
        cursor = Math.max(cursor, region.endBeat);
    }
    if (cursor < clip.endBeat) {
        gaps.push({ startBeat: cursor, endBeat: clip.endBeat });
    }
    return gaps;
}

export function projectBaseOccurrences(
    {
        clip,
        baseRows,
        covered,
        base,
    }: {
        clip: ClipPlacement;
        baseRows: readonly MidiNote[];
        covered: readonly { startBeat: number; endBeat: number }[];
        base: { ownersByViewId: ReadonlyMap<string, BaseGapPianoRollNoteOwner> };
    },
    window: QueryWindow,
    budget: QueryBudget
): readonly BaseOccurrence[] {
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const grid = resolveClipLoopPassGrid({
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled ?? false,
        loopLengthBeats: expansion.loopLengthBeats,
        iterationCount: expansion.iterationCount,
    });
    const first = Math.max(0, Math.floor((window.fromBeat - grid.firstPassStartBeat) / expansion.loopLengthBeats));
    const last = Math.min(
        grid.passCount,
        Math.ceil((window.toBeat - grid.firstPassStartBeat) / expansion.loopLengthBeats)
    );
    if (
        !Number.isSafeInteger(first) ||
        !Number.isSafeInteger(last) ||
        first > last ||
        grid.firstPassStartBeat + first * expansion.loopLengthBeats + expansion.loopLengthBeats <=
            grid.firstPassStartBeat + first * expansion.loopLengthBeats
    ) {
        throw new Error('MIDI projection work budget exceeded');
    }
    const passes = last - first;
    const segments = Math.max(1, covered.length + 1);
    budget.charge(
        passes *
            Math.max(1, baseRows.length) *
            2 *
            (baseRows.length + segments * base.ownersByViewId.size + segments + 3)
    );
    budget.emit(passes * baseRows.length * 2 * segments);
    const gaps = uncoveredGaps(clip, covered);
    const occurrences: Array<BaseOccurrence> = [];
    for (let index = first; index < last; index++) {
        const events = projectClipMidiEvents({
            events: baseRows,
            clipId: clip.id,
            clipStartBeat: clip.startBeat,
            clipEndBeat: clip.endBeat,
            iterationStartBeat: grid.firstPassStartBeat + index * expansion.loopLengthBeats,
            loopLengthBeats: expansion.loopLengthBeats,
            midiOffsetBeats: clip.midiOffsetBeats ?? 0,
            loopEnabled: clip.loopEnabled,
            loopOriginBeat: clip.loopOriginBeat,
        });
        for (const event of events) {
            const row = baseRows.find((candidate) => candidate.id === event.id);
            if (!row) {
                throw new Error('Projected MIDI note has no source row');
            }
            appendEventOccurrences(
                { event, row, occurrenceIndex: grid.passesAheadOfAnchor + index },
                { gaps, clip, base, window },
                occurrences
            );
        }
    }
    return occurrences;
}
