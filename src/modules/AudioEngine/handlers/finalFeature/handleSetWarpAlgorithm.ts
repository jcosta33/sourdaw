import { createHandler } from '#/helpers/createHandler';
import { type WarpAlgorithm } from '../../stores/audioWarp';
import { setWarpAlgorithm } from '../../useCases/audioWarping/setWarpAlgorithm';

export const handleSetWarpAlgorithm = createHandler<'setWarpAlgorithm'>({
    execute: (a) => {
        setWarpAlgorithm(a.payload.clipId, a.payload.algorithm as WarpAlgorithm);
    },
    describe: () => ({ label: 'Set Warp Algorithm' }),
    undoable: true,
});
