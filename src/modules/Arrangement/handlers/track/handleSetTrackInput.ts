import { createHandler } from '#/utils/createHandler';

import { setTrackInput } from '../../useCases/setTrackInput';

export const handleSetTrackInput = createHandler<'setTrackInput'>({
    execute: (action) => {
        setTrackInput(action.payload.trackId, action.payload.inputId);
    },
    describe: () => ({ label: 'Set track input' }),
    undoable: true,
});
