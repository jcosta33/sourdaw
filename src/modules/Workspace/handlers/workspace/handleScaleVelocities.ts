import { createHandler } from '#/utils/createHandler';
import { scaleVelocities } from '#/modules/MIDI/useCases';
import { type VelocityCurve } from '#/modules/Arrangement/useCases';

export const handleScaleVelocities = createHandler<'scaleVelocities'>({
    execute: (a) => {
        scaleVelocities(
            a.payload.clipId,
            a.payload.curve as VelocityCurve,
            a.payload.minVelocity,
            a.payload.maxVelocity
        );
    },
    describe: (a) => ({ label: `Scale velocities (${a.payload.curve})` }),
    undoable: true,
});
