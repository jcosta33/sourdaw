import { createHandler } from '#/helpers/createHandler';
import { setClipColor } from '../../useCases/clipEditing/setClipColor';

export const handleSetClipColor = createHandler<'setClipColor'>({
    execute: (a) => {
        setClipColor(a.payload.clipId, a.payload.color);
    },
    describe: () => ({ label: 'Set clip color' }),
    undoable: true,
});
