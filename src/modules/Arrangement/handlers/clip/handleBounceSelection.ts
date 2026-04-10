import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { bounceSelection } from '../../useCases/freezeBounce/bounceOperations';
import type { ExtractAction } from '../types';

export const executeBounceSelection = inject({ bounceSelection })(
    ({ bounceSelection }) =>
        function executeBounceSelection(a: ExtractAction<AppAction, 'bounceSelection'>): void {
            bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        }
);

export const handleBounceSelection = createHandler<'bounceSelection'>({
    execute: executeBounceSelection,
    describe: () => ({ label: 'Bounce selection to audio' }),
    undoable: true,
});
