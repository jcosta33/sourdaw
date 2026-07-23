import { type ChordEvent } from '../../models/ChordEvent';
import { chordTrackStore } from '../../stores/chordTrackStore';
import { transposeForChordTrack } from '../../transformers/chordTransposer';

function findChordAtBeat(events: readonly ChordEvent[], beat: number): ChordEvent | null {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]!;
        if (event.beat <= beat && beat < event.beat + event.duration) {
            return event;
        }
    }
    return null;
}

export function createChordPitchProjector() {
    const state = chordTrackStore.value;
    const events = state?.enabled ? state.events.map((event) => ({ ...event })) : [];

    return ({ pitch, referenceBeat, targetBeat }: { pitch: number; referenceBeat: number; targetBeat: number }) =>
        transposeForChordTrack(pitch, findChordAtBeat(events, referenceBeat), findChordAtBeat(events, targetBeat));
}
