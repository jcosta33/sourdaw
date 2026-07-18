import { setPitchShift } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetWarpPitchShift = createHandler<'setWarpPitchShift'>({
    execute: (alpha) => {
        setPitchShift(alpha.payload.clipId, alpha.payload.semitones);
    },
    describe: () => ({ label: 'Set Warp Pitch Shift' }),
    undoable: true,
});
