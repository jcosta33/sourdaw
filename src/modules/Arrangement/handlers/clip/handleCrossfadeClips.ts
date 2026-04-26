import { createHandler } from '#/utils/createHandler';

import { crossfadeClips } from '../../useCases/clipEditing/crossfadeClips';

export const handleCrossfadeClips = createHandler<'crossfadeClips'>({
    execute: (alpha) => {
        crossfadeClips(alpha.payload.clipAId, alpha.payload.clipBId, alpha.payload.durationBeats);
    },
    describe: () => ({ label: 'Crossfade clips' }),
    undoable: true,
});
