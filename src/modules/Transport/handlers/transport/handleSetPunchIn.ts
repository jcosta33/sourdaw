import { createHandler } from '#/utils/createHandler';

import { setPunchIn } from '../../useCases/transportControls/setPunchIn';

export const handleSetPunchIn = createHandler<'setPunchIn'>({
    execute: (alpha) => {
        setPunchIn(alpha.payload.beat);
    },
    describe: (alpha) => ({ label: `Set punch in at beat ${alpha.payload.beat}` }),
    undoable: true,
});
