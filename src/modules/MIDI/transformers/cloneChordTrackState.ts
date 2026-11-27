import { type ChordTrackState, type ReadonlyChordTrackState } from '../models/ChordTrackState';

export function cloneChordTrackState(state: ReadonlyChordTrackState): ChordTrackState {
    return {
        enabled: state.enabled,
        events: state.events.map((event) => ({
            id: event.id,
            beat: event.beat,
            root: event.root,
            quality: event.quality,
            duration: event.duration,
        })),
    };
}
