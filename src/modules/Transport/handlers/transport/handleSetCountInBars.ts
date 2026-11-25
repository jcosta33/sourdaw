import { createHandler } from '#/utils/createHandler';

import { setCountInBars } from '../../useCases/transportControls/setCountInBars';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { clampTransportBars } from './clampTransportBars';

export const handleSetCountInBars = createHandler<'setCountInBars'>({
    execute: (alpha) => {
        setCountInBars(alpha.payload.bars);
    },
    isNoop: (alpha) => getTransportState()?.countInBars === clampTransportBars(alpha.payload.bars),
    describe: (alpha) => {
        const previous = getTransportState()?.countInBars;
        const bars = clampTransportBars(alpha.payload.bars);
        return {
            label: `Set count-in to ${bars} bars`,
            inverseAction: previous === undefined ? null : { type: 'setCountInBars', payload: { bars: previous } },
            redoAction: { type: 'setCountInBars', payload: { bars } },
        };
    },
    undoable: true,
});
