import { createHandler } from '#/utils/createHandler';

import { glueClips } from '../../useCases/clipEditing/glueClips';

export const handleGlueClips = createHandler<'glueClips'>({
    execute: (alpha) => {
        glueClips(alpha.payload.clipIds);
    },
    describe: () => ({ label: 'Glue clips' }),
    undoable: true,
});
