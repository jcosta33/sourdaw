import { createHandler } from '#/utils/createHandler';

import { setClipFade } from '../../useCases/clipEditing/setClipFade';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipFade = createHandler<'setClipFade'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            setClipFade(alpha.payload.clipId, alpha.payload.fadeInBeats, alpha.payload.fadeOutBeats)
        );
    },
    describe: () => ({ label: 'Set clip fade' }),
    undoable: true,
});
