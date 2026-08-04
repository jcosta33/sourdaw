import { type MidiStoreState } from '#/modules/MIDI/stores';

type ScheduledMidiNote = MidiStoreState['notesByClipId'][string][number];

type LoopPhaseEntry = {
    endPhaseBeat: number;
    note: ScheduledMidiNote;
    phaseBeat: number;
};

type ScheduledMidiLoopIndex = {
    loopLengthBeats: number;
    midiOffsetBeats: number;
    orderByNote: ReadonlyMap<ScheduledMidiNote, number>;
    sortedEntries: readonly LoopPhaseEntry[];
    sortedEnds: readonly LoopPhaseEntry[];
};

type SelectMidiNotesForLoopWindowInput = {
    notes: readonly ScheduledMidiNote[];
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    fromBeat: number;
    toBeat: number;
    lastScheduledBeat: number;
    grooveLookaroundBeats: number;
};

const scheduledMidiLoopIndexes = new WeakMap<readonly ScheduledMidiNote[], ScheduledMidiLoopIndex>();

function positiveModulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function getScheduledMidiLoopIndex({
    notes,
    loopLengthBeats,
    midiOffsetBeats,
}: Pick<SelectMidiNotesForLoopWindowInput, 'notes' | 'loopLengthBeats' | 'midiOffsetBeats'>): ScheduledMidiLoopIndex {
    const cached = scheduledMidiLoopIndexes.get(notes);
    if (cached?.loopLengthBeats === loopLengthBeats && cached.midiOffsetBeats === midiOffsetBeats) {
        return cached;
    }

    const orderByNote = new Map<ScheduledMidiNote, number>();
    const sortedEntries: LoopPhaseEntry[] = [];
    for (let index = 0; index < notes.length; index++) {
        const note = notes[index]!;
        orderByNote.set(note, index);
        const relativeStartBeat = note.startBeat - midiOffsetBeats;
        if (relativeStartBeat >= loopLengthBeats) {
            continue;
        }
        const phaseBeat = positiveModulo(relativeStartBeat, loopLengthBeats);
        sortedEntries.push({
            endPhaseBeat: phaseBeat + Math.min(note.duration, loopLengthBeats),
            note,
            phaseBeat,
        });
    }
    sortedEntries.sort(
        (left, right) => left.phaseBeat - right.phaseBeat || orderByNote.get(left.note)! - orderByNote.get(right.note)!
    );
    const created = {
        loopLengthBeats,
        midiOffsetBeats,
        orderByNote,
        sortedEntries,
        sortedEnds: [...sortedEntries].sort((left, right) => left.endPhaseBeat - right.endPhaseBeat),
    };
    scheduledMidiLoopIndexes.set(notes, created);
    return created;
}

function lowerBoundLoopPhase(entries: readonly LoopPhaseEntry[], phaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.phaseBeat < phaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function lowerBoundLoopEnd(entries: readonly LoopPhaseEntry[], endPhaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.endPhaseBeat < endPhaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

export function selectMidiNotesForLoopWindow({
    notes,
    iterationStartBeat,
    loopLengthBeats,
    midiOffsetBeats,
    fromBeat,
    toBeat,
    lastScheduledBeat,
    grooveLookaroundBeats,
}: SelectMidiNotesForLoopWindowInput): readonly ScheduledMidiNote[] {
    const { orderByNote, sortedEnds, sortedEntries } = getScheduledMidiLoopIndex({
        notes,
        loopLengthBeats,
        midiOffsetBeats,
    });
    const schedulerStartBeat = Math.max(fromBeat, lastScheduledBeat);
    const schedulesIterationBoundary =
        iterationStartBeat >= fromBeat && iterationStartBeat < toBeat && iterationStartBeat >= lastScheduledBeat;
    const phaseStartBeat = schedulerStartBeat - iterationStartBeat - grooveLookaroundBeats;
    const phaseEndBeat = toBeat - iterationStartBeat + grooveLookaroundBeats;
    const phaseWidthBeats = phaseEndBeat - phaseStartBeat;
    const candidates = new Set<ScheduledMidiNote>();
    if (phaseWidthBeats >= loopLengthBeats) {
        for (const { note } of sortedEntries) {
            candidates.add(note);
        }
    } else {
        const normalizedStartBeat = positiveModulo(phaseStartBeat, loopLengthBeats);
        const normalizedEndBeat = normalizedStartBeat + phaseWidthBeats;
        const startIndex = lowerBoundLoopPhase(sortedEntries, normalizedStartBeat);
        if (normalizedEndBeat <= loopLengthBeats) {
            const endIndex = lowerBoundLoopPhase(sortedEntries, normalizedEndBeat);
            for (let index = startIndex; index < endIndex; index++) {
                candidates.add(sortedEntries[index]!.note);
            }
        } else {
            const wrappedEndIndex = lowerBoundLoopPhase(sortedEntries, normalizedEndBeat - loopLengthBeats);
            for (let index = startIndex; index < sortedEntries.length; index++) {
                candidates.add(sortedEntries[index]!.note);
            }
            for (let index = 0; index < wrappedEndIndex; index++) {
                candidates.add(sortedEntries[index]!.note);
            }
        }
        if (schedulesIterationBoundary) {
            const boundaryEndIndex = lowerBoundLoopEnd(sortedEnds, loopLengthBeats - grooveLookaroundBeats);
            for (let index = boundaryEndIndex; index < sortedEnds.length; index++) {
                candidates.add(sortedEnds[index]!.note);
            }
        }
    }
    return [...candidates].sort((left, right) => orderByNote.get(left)! - orderByNote.get(right)!);
}
