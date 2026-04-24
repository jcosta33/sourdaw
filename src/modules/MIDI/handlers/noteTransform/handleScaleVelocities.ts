import { createHandler } from '#/utils/createHandler';

import { scaleVelocities } from '../../useCases/midiNoteTransforms/scaleVelocities';

export const handleScaleVelocities = createHandler<'scaleVelocities'>({
    execute: (action) => {
        scaleVelocities(
            action.payload.clipId,
            action.payload.curve,
            action.payload.minVelocity,
            action.payload.maxVelocity
        );
    },
    describe: (action) => ({ label: `Scale velocities (${action.payload.curve})` }),
    undoable: true,
});
