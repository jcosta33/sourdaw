import { setTrackInput } from '../../useCases/setTrackInput';
import { createHandler } from '#/helpers/createHandler';

export const handleSetTrackInput = createHandler<'setTrackInput'>({
    execute: (action) => {
        setTrackInput(action.payload.trackId, action.payload.inputId);
    },
    describe: () => ({ label: 'Set track input' }),
    undoable: true,
});
