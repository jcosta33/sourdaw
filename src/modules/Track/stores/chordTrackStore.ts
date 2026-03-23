import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type ChordEvent } from '#/modules/Midi/models/ChordEvent';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

const logger = Container.getInstance().get(Logger);

const loadFromStorage = (): ChordTrackState => {
    try {
        const stored = localStorage.getItem('webdaw_chord_track');
        if (stored) {
            return JSON.parse(stored) as ChordTrackState;
        }
    } catch {
        // Fallback
    }
    return { enabled: false, events: [] };
};

export const chordTrackStore = new Store<ChordTrackState>(logger, {
    initialData: loadFromStorage(),
});

/** Persist chord track state to localStorage on every change. */
chordTrackStore.subscribe(() => {
    const state = chordTrackStore.value;
    if (state) {
        localStorage.setItem('webdaw_chord_track', JSON.stringify(state));
    }
});
