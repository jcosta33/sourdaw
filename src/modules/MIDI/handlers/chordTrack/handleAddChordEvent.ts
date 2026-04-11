import { createHandler } from '#/helpers/createHandler';
import { addChordEvent } from '../../useCases/chordTrack/addChordEvent';
import { type ChordType, CHORD_TYPES } from '../../useCases/chordStamps/helpers';

const VALID_CHORD_QUALITIES = new Set(Object.keys(CHORD_TYPES));

export const handleAddChordEvent = createHandler<'addChordEvent'>({
    execute: (a) => {
        const quality = VALID_CHORD_QUALITIES.has(a.payload.quality) ? (a.payload.quality as ChordType) : 'major';
        const root = Math.max(0, Math.min(11, Math.round(a.payload.root)));
        const beat = Math.max(0, a.payload.beat);
        const duration = a.payload.duration ?? 4;
        addChordEvent(beat, root, quality, duration);
    },
    describe: (a) => ({ label: `Add ${a.payload.quality} chord at beat ${a.payload.beat}` }),
    undoable: true,
});
