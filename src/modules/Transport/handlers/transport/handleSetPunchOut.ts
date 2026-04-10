import { createHandler } from '#/helpers/createHandler';
import { setPunchOut } from '../../useCases/transportControls/setPunchOut';

export const handleSetPunchOut = createHandler<'setPunchOut'>({
    execute: (a) => {
        setPunchOut(a.payload.beat);
    },
    describe: (a) => ({ label: `Set punch out at beat ${a.payload.beat}` }),
    undoable: true,
});
