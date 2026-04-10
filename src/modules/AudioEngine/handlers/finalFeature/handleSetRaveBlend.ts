import { createHandler } from '#/helpers/createHandler';
import { setTransferBlend } from '../../useCases/rave/setTransferBlend';

export const handleSetRaveBlend = createHandler<'setRaveBlend'>({
    execute: (a) => {
        setTransferBlend(a.payload.blend);
    },
    describe: () => ({ label: 'Set RAVE Timbre Blend' }),
    undoable: false,
});
