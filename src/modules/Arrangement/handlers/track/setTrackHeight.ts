import { createHandler } from '#/helpers/createHandler';
import { setTrackHeight } from '#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight';

export const handleSetTrackHeight = createHandler<'setTrackHeight'>({
    execute: (action) => {
        setTrackHeight(action.payload.trackId, action.payload.height);
    },
    describe: () => ({ label: 'Set track height' }),
    undoable: true,
});
