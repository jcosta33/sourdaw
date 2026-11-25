import { createHandler } from '#/utils/createHandler';

import { setPreRollBars } from '../../useCases/transportControls/setPreRollBars';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { clampTransportBars } from './clampTransportBars';

export const handleSetPreRollBars = createHandler<'setPreRollBars'>({
    execute: (alpha) => {
        setPreRollBars(alpha.payload.bars);
    },
    isNoop: (alpha) => getTransportState()?.preRollBars === clampTransportBars(alpha.payload.bars),
    describe: (alpha) => {
        const previous = getTransportState()?.preRollBars;
        const bars = clampTransportBars(alpha.payload.bars);
        return {
            label: `Set pre-roll to ${bars} bars`,
            inverseAction: previous === undefined ? null : { type: 'setPreRollBars', payload: { bars: previous } },
            redoAction: { type: 'setPreRollBars', payload: { bars } },
        };
    },
    undoable: true,
});
