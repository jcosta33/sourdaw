import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { groupTracks } from '#/modules/Arrangement/useCases/toggleTrackState/groupTracks';
import type { ExtractAction } from '../types';

const executeGroupTracks = inject({ groupTracks })(
    ({ groupTracks }) =>
        function executeGroupTracks(a: ExtractAction<AppAction, 'groupTracks'>): void {
            groupTracks(a.payload.trackIds, a.payload.name);
        }
);

export const handleGroupTracks = createHandler<'groupTracks'>({
    execute: executeGroupTracks,
    describe: (a) => ({ label: `Group tracks: "${a.payload.name}"` }),
    undoable: true,
});
