import { scaleVelocities } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleScaleVelocities = createHandler<'scaleVelocities'>({
    execute: (a) => {
        scaleVelocities(
            a.payload.clipId,
            a.payload.curve,
            a.payload.minVelocity,
            a.payload.maxVelocity
        );
    },
    describe: (a) => ({ label: `Scale velocities (${a.payload.curve})` }),
    undoable: true,
});
