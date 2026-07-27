import { wireSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
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
                    finalizeModulationRemoval.afterCommit,
                    () => publishTrackRemoved({ trackId: action.payload.trackId }),
                ]),
            afterAmbiguousCommit: () => {
                const committedTrack = getTrackStoreState()?.tracks.find(
                    (candidate) => candidate.id === action.payload.trackId
                );
                const effects: Array<() => void | Promise<void>> = [
                    finalizeModulationRemoval.afterAmbiguousCommit,
                    () => wireSidechainRoutes(),
                ];
                if (committedTrack) {
                    effects.unshift(() =>
                        projectTrackToLiveStrip({
                            trackId: committedTrack.id,
                            activateDormantExternalPlugins: true,
                        })
                    );
                } else {
                    effects.unshift(result.finalizeRuntimeRemoval, () =>
                        publishTrackRemoved({ trackId: action.payload.trackId })
                    );
                }
                return runAllAsyncEffects(effects);
            },
        };
    },
    describe: () => ({ label: 'Discard created track' }),
    requiresAbortCompensation: false,
    undoable: false,
});
