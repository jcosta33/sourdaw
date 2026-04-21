import { createHandler } from '#/utils/createHandler';

import { setPunchOut } from '../../useCases/transportControls/setPunchOut';

export const handleSetPunchOut = createHandler<'setPunchOut'>({
    execute: (alpha) => {
        setPunchOut(alpha.payload.beat);
    },
    describe: (alpha) => ({ label: `Set punch out at beat ${alpha.payload.beat}` }),
    undoable: true,
});
