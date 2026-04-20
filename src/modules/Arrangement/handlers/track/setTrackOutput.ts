import { createHandler } from '#/utils/createHandler';

import { setTrackOutput } from '../../useCases/toggleTrackState/setTrackOutput';

export const handleSetTrackOutput = createHandler<'setTrackOutput'>({
    execute: (action) => {
        setTrackOutput(action.payload.trackId, action.payload.outputId);
    },
    describe: () => ({ label: 'Set track output' }),
    undoable: true,
});
