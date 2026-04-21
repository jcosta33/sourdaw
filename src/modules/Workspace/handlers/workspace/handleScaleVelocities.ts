import { type VelocityCurve } from '#/modules/Arrangement/useCases';
import { scaleVelocities } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleScaleVelocities = createHandler<'scaleVelocities'>({
    execute: (alpha) => {
        scaleVelocities(
            alpha.payload.clipId,
            alpha.payload.curve as VelocityCurve,
            alpha.payload.minVelocity,
            alpha.payload.maxVelocity
        );
    },
    describe: (alpha) => ({ label: `Scale velocities (${alpha.payload.curve})` }),
    undoable: true,
});
