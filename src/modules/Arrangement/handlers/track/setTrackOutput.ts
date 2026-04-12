import { setTrackOutput } from '../../useCases/toggleTrackState/setTrackOutput';
import { createHandler } from '#/utils/createHandler';

export const handleSetTrackOutput = createHandler<'setTrackOutput'>({
    execute: (action) => {
        setTrackOutput(action.payload.trackId, action.payload.outputId);
    },
    describe: () => ({ label: 'Set track output' }),
    undoable: true,
});
