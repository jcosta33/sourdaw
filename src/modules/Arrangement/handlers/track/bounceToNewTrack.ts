import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { bounceToNewTrack } from '#/modules/Arrangement/useCases/freezeBounce/bounceOperations';
import type { ExtractAction } from '../types';

const executeBounceToNewTrack = inject({ bounceToNewTrack })(
    ({ bounceToNewTrack }) =>
        async function executeBounceToNewTrack(a: ExtractAction<AppAction, 'bounceToNewTrack'>): Promise<void> {
            await bounceToNewTrack(a.payload.trackId);
        }
);

export const handleBounceToNewTrack = createHandler<'bounceToNewTrack'>({
    execute: executeBounceToNewTrack,
    describe: () => ({ label: 'Bounce to new track' }),
    undoable: true,
});
