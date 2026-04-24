import { createHandler } from '#/utils/createHandler';

import { setTransferBlend } from '../../useCases/rave/setTransferBlend';

export const handleSetRaveBlend = createHandler<'setRaveBlend'>({
    execute: (alpha) => {
        setTransferBlend(alpha.payload.blend);
    },
    describe: () => ({ label: 'Set RAVE Timbre Blend' }),
    undoable: false,
});
