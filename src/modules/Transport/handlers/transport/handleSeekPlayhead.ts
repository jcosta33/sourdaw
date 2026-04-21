import { createHandler } from '#/utils/createHandler';

import { seekPlayhead } from '../../useCases/transportControls/seekPlayhead';

export const handleSeekPlayhead = createHandler<'seekPlayhead'>({
    execute: (alpha) => {
        seekPlayhead(alpha.payload.beat);
    },
    describe: (alpha) => ({ label: `Seek to beat ${alpha.payload.beat}` }),
    undoable: false,
});
