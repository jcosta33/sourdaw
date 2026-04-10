import { createHandler } from '#/helpers/createHandler';
import { cutSelectedClip } from '../../useCases/clipboard/cutSelectedClip';

export const handleCutClip = createHandler<'cutClip'>({
    execute: () => {
        cutSelectedClip();
    },
    describe: () => ({ label: 'Cut clip' }),
    undoable: true,
});
