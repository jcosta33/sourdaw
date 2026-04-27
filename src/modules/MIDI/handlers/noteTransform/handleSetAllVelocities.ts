import { createHandler } from '#/utils/createHandler';

import { setAllVelocities } from '../../useCases/midiNoteTransforms/setAllVelocities';

export const handleSetAllVelocities = createHandler<'setAllVelocities'>({
    execute: (action) => {
        setAllVelocities(action.payload.clipId, action.payload.velocity);
    },
    describe: (action) => ({ label: `Set all velocities to ${action.payload.velocity}` }),
    undoable: true,
});
