import { createHandler } from '#/utils/createHandler';

import { setTempo } from '../../useCases/setTempo';
import { getTempoAtPlayhead } from '../../useCases/transportQueries/getTempoAtPlayhead';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

// Transport-field range, mirrored from `setTempo`. A governing tempo-map event
// may legally sit above it (map events accept up to 999 BPM), and an inverse
// action carrying such a value would throw on undo instead of restoring it.
const MIN_SETTABLE_TEMPO = 20;
const MAX_SETTABLE_TEMPO = 300;

export const handleSetTempo = createHandler<'setTempo'>({
    execute: (alpha) => {
        setTempo(alpha.payload.bpm);
    },
    // Compare against the governing tempo, not `transport.tempo`: with a tempo
    // map the base tempo is inert, so comparing against it would call a real
    // edit a no-op (and treat a real no-op as an edit).
    isNoop: (action) => getTempoAtPlayhead() === action.payload.bpm,
    describe: (alpha) => {
        const label = `Set tempo to ${alpha.payload.bpm} BPM`;
        if (!getTransportState()) {
            return { label, inverseAction: null };
        }

        const previousTempo = getTempoAtPlayhead();
        if (previousTempo < MIN_SETTABLE_TEMPO || previousTempo > MAX_SETTABLE_TEMPO) {
            return { label, inverseAction: null };
        }

        return { label, inverseAction: { type: 'setTempo', payload: { bpm: previousTempo } } };
    },
    undoable: true,
});
