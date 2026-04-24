import { createHandler } from '#/utils/createHandler';

import { addClip } from '../../useCases/clip/addClip';

export const handleAddClip = createHandler<'addClip'>({
    execute: (alpha) => {
        addClip(alpha.payload);
    },
    describe: (alpha) => ({ label: `Add clip "${alpha.payload.name}"` }),
    undoable: true,
});
