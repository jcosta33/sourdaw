import { createHandler } from '#/helpers/createHandler';
import { addClip } from '../../useCases/clip/addClip';

export const handleAddClip = createHandler<'addClip'>({
    execute: (a) => {
        addClip(a.payload);
    },
    describe: (a) => ({ label: `Add clip "${a.payload.name}"` }),
    undoable: true,
});
