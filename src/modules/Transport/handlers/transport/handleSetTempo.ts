import { createHandler } from '#/utils/createHandler';

import { setTempo } from '../../useCases/setTempo';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetTempo = createHandler<'setTempo'>({
    execute: (alpha) => {
        setTempo(alpha.payload.bpm);
    },
    isNoop: (action) => getTransportState()?.tempo === action.payload.bpm,
    describe: (alpha) => {
        const previousTempo = getTransportState()?.tempo;
        return {
            label: `Set tempo to ${alpha.payload.bpm} BPM`,
            inverseAction: previousTempo === undefined ? null : { type: 'setTempo', payload: { bpm: previousTempo } },
        };
    },
    undoable: true,
});
