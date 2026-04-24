import { scaleAllVelocities } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleScaleAllVelocities = createHandler<'scaleAllVelocities'>({
    execute: (alpha) => {
        scaleAllVelocities(alpha.payload.clipId, alpha.payload.factor);
    },
    describe: (alpha) => ({ label: `Scale velocities ×${alpha.payload.factor}` }),
    undoable: true,
});
