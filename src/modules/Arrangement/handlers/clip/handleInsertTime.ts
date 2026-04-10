import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { insertTime } from '../../useCases/timeOperations';
import type { ExtractAction } from '../types';

export const executeInsertTime = inject({ insertTime })(
    ({ insertTime }) =>
        function executeInsertTime(a: ExtractAction<AppAction, 'insertTime'>): void {
            insertTime(a.payload.atBeat, a.payload.durationBeats);
        }
);

export const handleInsertTime = createHandler<'insertTime'>({
    execute: executeInsertTime,
    describe: () => ({ label: 'Insert time' }),
    undoable: true,
});
