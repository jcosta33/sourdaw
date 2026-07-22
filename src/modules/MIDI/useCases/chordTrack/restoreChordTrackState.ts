import { type ChordEvent } from '../../models/ChordEvent';
import { chordTrackStore } from '../../stores/chordTrackStore';

type RestoreChordTrackStateInput = {
    enabled: boolean;
    events: readonly ChordEvent[];
};

export function restoreChordTrackState(input: RestoreChordTrackStateInput): void {
    chordTrackStore.set({
        enabled: input.enabled,
        events: input.events.map((event) => ({ ...event })),
    });
}
