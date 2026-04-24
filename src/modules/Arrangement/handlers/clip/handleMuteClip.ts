import { createHandler } from '#/utils/createHandler';

import { muteClip } from '../../useCases/clipEditing/muteClip';

export const handleMuteClip = createHandler<'muteClip'>({
    execute: (alpha) => {
        muteClip(alpha.payload.clipId, alpha.payload.muted);
    },
    describe: (alpha) => ({ label: alpha.payload.muted ? 'Mute clip' : 'Unmute clip' }),
    undoable: true,
});
