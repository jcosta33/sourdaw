import { createHandler } from '#/helpers/createHandler';
import { muteClip } from '../../useCases/clipEditing/muteClip';

export const handleMuteClip = createHandler<'muteClip'>({
    execute: (a) => {
        muteClip(a.payload.clipId, a.payload.muted);
    },
    describe: (a) => ({ label: a.payload.muted ? 'Mute clip' : 'Unmute clip' }),
    undoable: true,
});
