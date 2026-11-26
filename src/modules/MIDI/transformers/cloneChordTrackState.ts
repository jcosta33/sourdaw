import { type ChordTrackActionSnapshot } from '../events/midiAppActions';
import { type ChordTrackState } from '../stores/chordTrackStore';

export function cloneChordTrackState(state: ChordTrackActionSnapshot): ChordTrackState {
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
