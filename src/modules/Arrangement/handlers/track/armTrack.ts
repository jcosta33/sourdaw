import { createHandler } from '#/utils/createHandler';

import { armTrack } from '../../useCases/recording/armTrack';

export const handleArmTrack = createHandler<'armTrack'>({
    execute: (action) => {
        armTrack(action.payload.trackId, action.payload.armed);
    },
    describe: (alpha) => ({ label: alpha.payload.armed ? 'Arm track' : 'Disarm track' }),
    undoable: true,
});
