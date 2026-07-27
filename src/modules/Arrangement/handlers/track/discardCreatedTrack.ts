import { createHandler } from '#/utils/createHandler';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';

export const handleDiscardCreatedTrack = createHandler<'discardCreatedTrack'>({
    execute: (action) => {
        const result = removeTrack(action.payload.trackId, {
            deferRuntimeEffects: true,
            suppressRemovedEvent: true,
        });
        if (!result.removed) {
            return { status: 'written' };
        }
        const finalizeModulationRemoval = removeTrackModulationReferences({
            trackId: action.payload.trackId,
            deferRuntimeEffects: true,
        });
        return {
            status: 'written',
            afterCommit: () =>
                runAllAsyncEffects([
                    result.finalizeRuntimeRemoval,
                    finalizeModulationRemoval,
                    () => publishTrackRemoved({ trackId: action.payload.trackId }),
                ]),
        };
    },
    describe: () => ({ label: 'Discard created track' }),
    undoable: false,
});
