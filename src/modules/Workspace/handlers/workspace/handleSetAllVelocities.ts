import { setAllVelocities } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetAllVelocities = createHandler<'setAllVelocities'>({
    execute: (alpha) => {
        setAllVelocities(alpha.payload.clipId, alpha.payload.velocity);
    },
    describe: (alpha) => ({ label: `Set all velocities to ${alpha.payload.velocity}` }),
    undoable: true,
});
