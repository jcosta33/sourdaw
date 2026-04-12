import { createHandler } from '#/utils/createHandler';
import { crossfadeClips } from '../../useCases/clipEditing/crossfadeClips';

export const handleCrossfadeClips = createHandler<'crossfadeClips'>({
    execute: (a) => {
        crossfadeClips(a.payload.clipAId, a.payload.clipBId, a.payload.durationBeats);
    },
    describe: () => ({ label: 'Crossfade clips' }),
    undoable: true,
});
