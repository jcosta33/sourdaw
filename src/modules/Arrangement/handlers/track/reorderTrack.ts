import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { reorderTrack } from '#/modules/Arrangement/useCases/toggleTrackState/reorderTrack';
import type { ExtractAction } from '../types';

const executeReorderTrack = inject({ reorderTrack })(
    ({ reorderTrack }) =>
        function executeReorderTrack(a: ExtractAction<AppAction, 'reorderTrack'>): void {
            reorderTrack(a.payload.trackId, a.payload.newIndex);
        }
);

export const handleReorderTrack = createHandler<'reorderTrack'>({
    execute: executeReorderTrack,
    describe: () => ({ label: 'Reorder track' }),
    undoable: true,
});
