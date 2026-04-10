import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { bounceInPlace } from '#/modules/Arrangement/useCases/freezeBounce/bounceOperations';
import type { ExtractAction } from '../types';

const executeBounceInPlace = inject({ bounceInPlace })(
    ({ bounceInPlace }) =>
        function executeBounceInPlace(a: ExtractAction<AppAction, 'bounceInPlace'>): void {
            bounceInPlace(a.payload.trackId);
        }
);

export const handleBounceInPlace = createHandler<'bounceInPlace'>({
    execute: executeBounceInPlace,
    describe: () => ({ label: 'Bounce in place' }),
    undoable: true,
});
