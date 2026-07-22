import { chordTrackStore, defaultChordTrackState, type ChordTrackState } from '../../stores/chordTrackStore';

export function replaceChordTrackState(state: ChordTrackState | undefined): void {
    const nextState = state ?? defaultChordTrackState;
    chordTrackStore.set({
        enabled: nextState.enabled,
        events: nextState.events.map((event) => ({ ...event })).sort((left, right) => left.beat - right.beat),
    });
}
