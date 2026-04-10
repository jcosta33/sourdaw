import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { createHandler } from '#/helpers/createHandler';
import { bounceInPlace } from '#/modules/Arrangement/useCases/freezeBounce/bounceOperations';
import type { ExtractAction } from '../types';

const executeConsolidateAllTracks = inject({ getTrackStoreState, bounceInPlace })(
    ({ getTrackStoreState, bounceInPlace }) =>
        async function executeConsolidateAllTracks(
            _action: ExtractAction<AppAction, 'consolidateAllTracks'>
        ): Promise<void> {
            const state = getTrackStoreState();
            if (!state) {
                return;
            }
            for (const track of state.tracks) {
                if ((track.kind === 'audio' || track.kind === 'midi') && track.clips.length > 0) {
                    await bounceInPlace(track.id);
                }
            }
        }
);

export const handleConsolidateAllTracks = createHandler<'consolidateAllTracks'>({
    execute: executeConsolidateAllTracks,
    describe: () => ({ label: 'Consolidate all tracks' }),
    undoable: true,
});
