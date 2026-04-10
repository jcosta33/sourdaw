import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { duplicateTimeRange } from '../../useCases/timeOperations';
import type { ExtractAction } from '../types';

export const executeDuplicateTimeRange = inject({ duplicateTimeRange })(
    ({ duplicateTimeRange }) =>
        function executeDuplicateTimeRange(a: ExtractAction<AppAction, 'duplicateTimeRange'>): void {
            duplicateTimeRange(a.payload.startBeat, a.payload.endBeat);
        }
);

export const handleDuplicateTimeRange = createHandler<'duplicateTimeRange'>({
    execute: executeDuplicateTimeRange,
    describe: () => ({ label: 'Duplicate time range' }),
    undoable: true,
});
