import { createHandler } from '#/utils/createHandler';

import { setPitchShift } from '../../useCases/audioWarping/setPitchShift';

export const handleSetWarpPitchShift = createHandler<'setWarpPitchShift'>({
    execute: (alpha) => {
        setPitchShift(alpha.payload.clipId, alpha.payload.semitones);
    },
    describe: () => ({ label: 'Set Warp Pitch Shift' }),
    undoable: true,
});
