import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { ungroupTracks } from '#/modules/Arrangement/useCases/toggleTrackState/ungroupTracks';
import type { ExtractAction } from '../types';

const executeUngroupTracks = inject({ ungroupTracks })(
    ({ ungroupTracks }) =>
        function executeUngroupTracks(a: ExtractAction<AppAction, 'ungroupTracks'>): void {
            ungroupTracks(a.payload.groupId);
        }
);

export const handleUngroupTracks = createHandler<'ungroupTracks'>({
    execute: executeUngroupTracks,
    describe: () => ({ label: 'Ungroup tracks' }),
    undoable: true,
});
