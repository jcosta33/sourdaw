import { createHandler } from '#/helpers/createHandler';
import { scaleAllVelocities } from '#/modules/MIDI';

export const handleScaleAllVelocities = createHandler<'scaleAllVelocities'>({
    execute: (a) => {
        scaleAllVelocities(a.payload.clipId, a.payload.factor);
    },
    describe: (a) => ({ label: `Scale velocities ×${a.payload.factor}` }),
    undoable: true,
});
