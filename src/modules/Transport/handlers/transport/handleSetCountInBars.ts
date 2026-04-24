import { createHandler } from '#/utils/createHandler';

import { setCountInBars } from '../../useCases/transportControls/setCountInBars';

export const handleSetCountInBars = createHandler<'setCountInBars'>({
    execute: (alpha) => {
        setCountInBars(alpha.payload.bars);
    },
    describe: (alpha) => ({ label: `Set count-in to ${alpha.payload.bars} bars` }),
    undoable: true,
});
