import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { clearSolos } from '../../useCases/toggleTrackState/clearSolos';

import { toSoloStateExecutionResult } from './toSoloStateExecutionResult';

export const handleClearSolos = createHandler<'clearSolos'>({
    execute: () => {
        return toSoloStateExecutionResult(clearSolos({ deferRuntimeEffect: true }));
    },
    describe: () => {
        const soloedTracks = (getTrackStoreState()?.tracks ?? [])
            .filter((track) => track.soloed)
            .map((track) => ({ trackId: track.id, soloed: true }));
        const clearedTracks = soloedTracks.map((track) => ({ ...track, soloed: false }));
        return {
            label: 'Clear all solos',
            inverseAction:
                soloedTracks.length > 0
                    ? {
                          type: 'restoreTrackSoloStates',
                          payload: { expected: clearedTracks, replacement: soloedTracks },
                      }
                    : null,
            redoAction:
                soloedTracks.length > 0
                    ? {
                          type: 'restoreTrackSoloStates',
                          payload: { expected: soloedTracks, replacement: clearedTracks },
                      }
                    : { type: 'clearSolos' },
        };
    },
    isNoop: () => !(getTrackStoreState()?.tracks.some((track) => track.soloed) ?? false),
    undoable: true,
});
