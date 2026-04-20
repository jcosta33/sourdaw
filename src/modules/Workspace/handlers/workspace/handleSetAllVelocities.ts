import { setAllVelocities } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetAllVelocities = createHandler<'setAllVelocities'>({
    execute: (a) => {
        setAllVelocities(a.payload.clipId, a.payload.velocity);
    },
    describe: (a) => ({ label: `Set all velocities to ${a.payload.velocity}` }),
    undoable: true,
});
