import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { selectTrack } from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';
import type { ExtractAction } from '../types';

const executeSelectTrack = inject({ selectTrack })(
    ({ selectTrack }) =>
        function executeSelectTrack(a: ExtractAction<AppAction, 'selectTrack'>): void {
            selectTrack(a.payload.trackId);
        }
);

export const handleSelectTrack = createHandler<'selectTrack'>({
    execute: executeSelectTrack,
    describe: () => ({ label: 'Select track' }),
    undoable: false,
});
