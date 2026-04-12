import { createHandler } from '#/utils/createHandler';
import { seekPlayhead } from '../../useCases/transportControls/seekPlayhead';

export const handleSeekPlayhead = createHandler<'seekPlayhead'>({
    execute: (a) => {
        seekPlayhead(a.payload.beat);
    },
    describe: (a) => ({ label: `Seek to beat ${a.payload.beat}` }),
    undoable: false,
});
