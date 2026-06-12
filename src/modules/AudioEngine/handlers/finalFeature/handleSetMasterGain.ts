import { createHandler } from '#/utils/createHandler';

import { setMasterGain } from '../../useCases/setMasterGain';

export const handleSetMasterGain = createHandler<'setMasterGain'>({
    execute: (action) => {
        setMasterGain(action.payload.gain);
    },
    describe: () => ({ label: 'Set master gain' }),
    undoable: true,
});
