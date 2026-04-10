import { createHandler } from '#/helpers/createHandler';
import { setAllVelocities } from '#/modules/MIDI';

export const handleSetAllVelocities = createHandler<'setAllVelocities'>({
    execute: (a) => {
        setAllVelocities(a.payload.clipId, a.payload.velocity);
    },
    describe: (a) => ({ label: `Set all velocities to ${a.payload.velocity}` }),
    undoable: true,
});
