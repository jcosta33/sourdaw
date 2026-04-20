import { createHandler } from '#/utils/createHandler';

import { setPitchShift } from '../../useCases/audioWarping/setPitchShift';

export const handleSetWarpPitchShift = createHandler<'setWarpPitchShift'>({
    execute: (a) => {
        setPitchShift(a.payload.clipId, a.payload.semitones);
    },
    describe: () => ({ label: 'Set Warp Pitch Shift' }),
    undoable: true,
});
