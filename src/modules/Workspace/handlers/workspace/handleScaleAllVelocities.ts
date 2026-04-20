import { scaleAllVelocities } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleScaleAllVelocities = createHandler<'scaleAllVelocities'>({
    execute: (a) => {
        scaleAllVelocities(a.payload.clipId, a.payload.factor);
    },
    describe: (a) => ({ label: `Scale velocities ×${a.payload.factor}` }),
    undoable: true,
});
