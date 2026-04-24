import { createHandler } from '#/utils/createHandler';

import { setPreRollBars } from '../../useCases/transportControls/setPreRollBars';

export const handleSetPreRollBars = createHandler<'setPreRollBars'>({
    execute: (alpha) => {
        setPreRollBars(alpha.payload.bars);
    },
    describe: (alpha) => ({ label: `Set pre-roll to ${alpha.payload.bars} bars` }),
    undoable: true,
});
