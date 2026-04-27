import { createHandler } from '#/utils/createHandler';

import { scaleAllVelocities } from '../../useCases/midiNoteTransforms/scaleAllVelocities';

export const handleScaleAllVelocities = createHandler<'scaleAllVelocities'>({
    execute: (action) => {
        scaleAllVelocities(action.payload.clipId, action.payload.factor);
    },
    describe: (action) => ({ label: `Scale velocities ×${action.payload.factor}` }),
    undoable: true,
});
