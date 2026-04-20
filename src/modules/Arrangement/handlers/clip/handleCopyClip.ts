import { createHandler } from '#/utils/createHandler';

import { copySelectedClip } from '../../useCases/clipboard/copySelectedClip';

export const handleCopyClip = createHandler<'copyClip'>({
    execute: () => {
        copySelectedClip();
    },
    describe: () => ({ label: 'Copy clip' }),
    undoable: false,
});
