import { createHandler } from '#/utils/createHandler';
import { pasteClip } from '../../useCases/clipboard/pasteClip';

export const handlePasteClip = createHandler<'pasteClip'>({
    execute: () => {
        pasteClip();
    },
    describe: () => ({ label: 'Paste clip' }),
    undoable: true,
});
