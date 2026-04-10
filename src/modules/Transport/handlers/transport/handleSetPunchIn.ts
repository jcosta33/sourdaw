import { createHandler } from '#/helpers/createHandler';
import { setPunchIn } from '../../useCases/transportControls/setPunchIn';

export const handleSetPunchIn = createHandler<'setPunchIn'>({
    execute: (a) => {
        setPunchIn(a.payload.beat);
    },
    describe: (a) => ({ label: `Set punch in at beat ${a.payload.beat}` }),
    undoable: true,
});
