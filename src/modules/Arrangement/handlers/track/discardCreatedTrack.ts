import { wireSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';
import { projectTrackThroughPriorBatchActions } from '../projectTrackThroughPriorBatchActions';

export const handleDiscardCreatedTrack = createHandler<'discardCreatedTrack'>({
    validate: (action, context) => {
        const guard = action.payload.generatedMidiStateGuard;
        if (!guard) {
            return true;
        }
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (track && guard.midiByClipIdJson === '{}') {
            return JSON.stringify(projectTrackThroughPriorBatchActions(track, context)) === guard.entityJson;
        }
        return isGeneratedMidiStateCurrent({
            entityId: action.payload.trackId,
            entityType: 'track',
            guard,
        });
    },
    execute: (action) => {
        const guard = action.payload.generatedMidiStateGuard;
        if (
            guard &&
            !isGeneratedMidiStateCurrent({
                entityId: action.payload.trackId,
                entityType: 'track',
                guard,
            })
        ) {
            return { status: 'conflict' };
        }
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
