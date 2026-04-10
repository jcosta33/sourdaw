import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { foldTrack } from '#/modules/Arrangement/useCases/toggleTrackState/foldTrack';
import type { ExtractAction } from '../types';

const executeFoldTrack = inject({ foldTrack })(
    ({ foldTrack }) =>
        function executeFoldTrack(a: ExtractAction<AppAction, 'foldTrack'>): void {
            foldTrack(a.payload.trackId, a.payload.folded);
        }
);

export const handleFoldTrack = createHandler<'foldTrack'>({
    execute: executeFoldTrack,
    describe: (a) => ({ label: a.payload.folded ? 'Fold track' : 'Unfold track' }),
    undoable: true,
});
