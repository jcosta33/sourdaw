import { chordTrackStore, defaultChordTrackState, type ChordTrackState } from '../../stores/chordTrackStore';

export function hydrateChordTrackProjectState(state: ChordTrackState | undefined): void {
    const nextState = state ?? defaultChordTrackState;
    chordTrackStore.set(structuredClone(nextState));
}
