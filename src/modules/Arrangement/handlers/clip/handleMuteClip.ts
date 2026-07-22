import { createHandler } from '#/utils/createHandler';

import { muteClip } from '../../useCases/clipEditing/muteClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleMuteClip = createHandler<'muteClip'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(muteClip(alpha.payload.clipId, alpha.payload.muted));
    },
    describe: (alpha) => ({ label: alpha.payload.muted ? 'Mute clip' : 'Unmute clip' }),
    undoable: true,
});
