import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { bounceSelection } from '../../useCases/freezeBounce/bounceOperations';
import type { ExtractAction } from '../types';

export const executeConsolidateSelection = inject({ bounceSelection })(
    ({ bounceSelection }) =>
        async function executeConsolidateSelection(a: ExtractAction<AppAction, 'consolidateSelection'>): Promise<void> {
            await bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
        }
);

export const handleConsolidateSelection = createHandler<'consolidateSelection'>({
    execute: executeConsolidateSelection,
    describe: () => ({ label: 'Consolidate selection' }),
    undoable: true,
});
