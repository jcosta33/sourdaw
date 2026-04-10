import { createHandler } from '#/helpers/createHandler';
import { reverseClip } from '../../useCases/clipEditing/reverseClip';

export const handleReverseClip = createHandler<'reverseClip'>({
    execute: (a) => {
        reverseClip(a.payload.clipId);
    },
    describe: () => ({ label: 'Reverse clip' }),
    undoable: true,
});
