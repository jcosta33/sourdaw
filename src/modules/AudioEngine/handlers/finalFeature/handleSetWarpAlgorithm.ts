import { createHandler } from '#/utils/createHandler';

import { type WarpAlgorithm } from '../../stores/audioWarp';
import { setWarpAlgorithm } from '../../useCases/audioWarping/setWarpAlgorithm';

export const handleSetWarpAlgorithm = createHandler<'setWarpAlgorithm'>({
    execute: (alpha) => {
        setWarpAlgorithm(alpha.payload.clipId, alpha.payload.algorithm as WarpAlgorithm);
    },
    describe: () => ({ label: 'Set Warp Algorithm' }),
    undoable: true,
});
