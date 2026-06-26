import { createHandler } from '#/utils/createHandler';

import { type ChordType, CHORD_TYPES } from '../../models/ChordTypes';
import { addChordEvent } from '../../useCases/chordTrack/addChordEvent';

function isChordType(value: string): value is ChordType {
    return Object.prototype.hasOwnProperty.call(CHORD_TYPES, value);
}

export const handleAddChordEvent = createHandler<'addChordEvent'>({
    execute: (alpha) => {
        const quality: ChordType = isChordType(alpha.payload.quality) ? alpha.payload.quality : 'major';
        const root = Math.max(0, Math.min(11, Math.round(alpha.payload.root)));
        const beat = Math.max(0, alpha.payload.beat);
        const duration = alpha.payload.duration ?? 4;
        addChordEvent(beat, root, quality, duration);
    },
    describe: (alpha) => ({ label: `Add ${alpha.payload.quality} chord at beat ${alpha.payload.beat}` }),
    undoable: true,
});
