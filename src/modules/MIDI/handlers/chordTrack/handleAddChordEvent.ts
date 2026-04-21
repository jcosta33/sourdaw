import { createHandler } from '#/utils/createHandler';

import { type ChordType, CHORD_TYPES } from '../../useCases/chordStamps/helpers';
import { addChordEvent } from '../../useCases/chordTrack/addChordEvent';

const VALID_CHORD_QUALITIES = new Set(Object.keys(CHORD_TYPES));

export const handleAddChordEvent = createHandler<'addChordEvent'>({
    execute: (alpha) => {
        const quality = VALID_CHORD_QUALITIES.has(alpha.payload.quality) ? (alpha.payload.quality as ChordType) : 'major';
        const root = Math.max(0, Math.min(11, Math.round(alpha.payload.root)));
        const beat = Math.max(0, alpha.payload.beat);
        const duration = alpha.payload.duration ?? 4;
        addChordEvent(beat, root, quality, duration);
    },
    describe: (alpha) => ({ label: `Add ${alpha.payload.quality} chord at beat ${alpha.payload.beat}` }),
    undoable: true,
});
