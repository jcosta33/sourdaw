import { chordTrackStore, type ChordTrackState } from '../../stores/chordTrackStore';

export function replaceChordTrackState(state: ChordTrackState): void {
    chordTrackStore.set({
        enabled: state.enabled,
        events: state.events.map((event) => ({ ...event })),
    });
}
