import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { removeTrack } from '../../useCases/removeTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { createHandler } from '#/helpers/createHandler';
import type { ExtractAction } from '../types';

const executeRemoveAllTracks = inject({ getTrackStoreState, removeTrack })(
    ({ getTrackStoreState, removeTrack }) =>
        function executeRemoveAllTracks(_action: ExtractAction<AppAction, 'removeAllTracks'>): void {
            const state = getTrackStoreState();
            if (state) {
                for (const t of state.tracks) {
                    removeTrack(t.id);
                }
            }
        }
);

export const handleRemoveAllTracks = createHandler<'removeAllTracks'>({
    execute: executeRemoveAllTracks,
    describe: () => ({ label: 'Remove all tracks' }),
    undoable: true,
});
