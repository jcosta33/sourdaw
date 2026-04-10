import { createHandler } from '#/helpers/createHandler';
import { glueClips } from '../../useCases/clipEditing/glueClips';

export const handleGlueClips = createHandler<'glueClips'>({
    execute: (a) => {
        glueClips(a.payload.clipIds);
    },
    describe: () => ({ label: 'Glue clips' }),
    undoable: true,
});
