import { createHandler } from '#/utils/createHandler';
import { setPreRollBars } from '../../useCases/transportControls/setPreRollBars';

export const handleSetPreRollBars = createHandler<'setPreRollBars'>({
    execute: (a) => {
        setPreRollBars(a.payload.bars);
    },
    describe: (a) => ({ label: `Set pre-roll to ${a.payload.bars} bars` }),
    undoable: true,
});
