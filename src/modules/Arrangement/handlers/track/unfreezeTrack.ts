import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { unfreezeTrack } from '#/modules/Arrangement/useCases/freezeBounce/freezeTrack';
import type { ExtractAction } from '../types';

const executeUnfreezeTrack = inject({ unfreezeTrack })(
    ({ unfreezeTrack }) =>
        function executeUnfreezeTrack(a: ExtractAction<AppAction, 'unfreezeTrack'>): void {
            unfreezeTrack(a.payload.trackId);
        }
);

export const handleUnfreezeTrack = createHandler<'unfreezeTrack'>({
    execute: executeUnfreezeTrack,
    describe: () => ({ label: 'Unfreeze track' }),
    undoable: true,
});
