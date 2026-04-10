import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { disableTrack } from '#/modules/Arrangement/useCases/toggleTrackState/disableTrack';
import type { ExtractAction } from '../types';

const executeDisableTrack = inject({ disableTrack })(
    ({ disableTrack }) =>
        function executeDisableTrack(a: ExtractAction<AppAction, 'disableTrack'>): void {
            disableTrack(a.payload.trackId, a.payload.disabled);
        }
);

export const handleDisableTrack = createHandler<'disableTrack'>({
    execute: executeDisableTrack,
    describe: (a) => ({ label: a.payload.disabled ? 'Disable track' : 'Enable track' }),
    undoable: true,
});
