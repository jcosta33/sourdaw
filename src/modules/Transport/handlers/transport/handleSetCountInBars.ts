import { createHandler } from '#/utils/createHandler';

import { setCountInBars } from '../../useCases/transportControls/setCountInBars';

export const handleSetCountInBars = createHandler<'setCountInBars'>({
    execute: (a) => {
        setCountInBars(a.payload.bars);
    },
    describe: (a) => ({ label: `Set count-in to ${a.payload.bars} bars` }),
    undoable: true,
});
