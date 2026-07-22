import { createHandler } from '#/utils/createHandler';

import { crossfadeClips } from '../../useCases/clipEditing/crossfadeClips';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleCrossfadeClips = createHandler<'crossfadeClips'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            crossfadeClips(alpha.payload.clipAId, alpha.payload.clipBId, alpha.payload.durationBeats)
        );
    },
    describe: () => ({ label: 'Crossfade clips' }),
    undoable: true,
});
