import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { deleteTime } from '../../useCases/timeOperations';
import type { ExtractAction } from '../types';

export const executeDeleteTime = inject({ deleteTime })(
    ({ deleteTime }) =>
        function executeDeleteTime(a: ExtractAction<AppAction, 'deleteTime'>): void {
            deleteTime(a.payload.startBeat, a.payload.endBeat);
        }
);

export const handleDeleteTime = createHandler<'deleteTime'>({
    execute: executeDeleteTime,
    describe: () => ({ label: 'Delete time' }),
    undoable: true,
});
