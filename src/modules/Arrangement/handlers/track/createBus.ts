import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { addTrack } from '../../useCases/addTrack';
import { createHandler } from '#/helpers/createHandler';
import type { ExtractAction } from '../types';

const executeCreateBus = inject({ addTrack })(
    ({ addTrack }) =>
        function executeCreateBus(a: ExtractAction<AppAction, 'createBus'>): void {
            addTrack({ name: a.payload.name, kind: 'bus' });
        }
);

export const handleCreateBus = createHandler<'createBus'>({
    execute: executeCreateBus,
    describe: (a) => ({ label: `Create bus "${a.payload.name}"` }),
    undoable: true,
});
