import { type WarpAlgorithm } from '#/modules/ElasticAudio/stores';
import { setWarpAlgorithm } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetWarpAlgorithm = createHandler<'setWarpAlgorithm'>({
    execute: (alpha) => {
        setWarpAlgorithm(alpha.payload.clipId, alpha.payload.algorithm as WarpAlgorithm);
    },
    describe: () => ({ label: 'Set Warp Algorithm' }),
    undoable: true,
});
