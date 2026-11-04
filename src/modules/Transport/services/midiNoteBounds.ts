type TimedNote = { startBeat: number; duration: number };

export function lowerBoundMidiNoteStart(notes: readonly TimedNote[], startBeat: number): number {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (notes[middle]!.startBeat < startBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

export function lowerBoundMidiNoteEnd(notes: readonly TimedNote[], endBeat: number): number {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        const note = notes[middle]!;
        if (note.startBeat + note.duration < endBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}
