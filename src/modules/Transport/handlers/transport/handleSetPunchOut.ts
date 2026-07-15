import { createHandler } from '#/utils/createHandler';

import { setPunchOut } from '../../useCases/transportControls/setPunchOut';

import { createPunchRegionRestoreAction } from './createPunchRegionRestoreAction';

export const handleSetPunchOut = createHandler<'setPunchOut'>({
    execute: (alpha) => {
        setPunchOut(alpha.payload.beat);
    },
    describe: (alpha) => ({
        label: `Set punch out at beat ${alpha.payload.beat}`,
        inverseAction: createPunchRegionRestoreAction(),
    }),
    undoable: true,
});
