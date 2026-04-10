import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { addTrack } from '../../useCases/addTrack';
import type { ExtractAction } from '../types';

export const executeAddTrack = inject({ addTrack })(
    ({ addTrack }) =>
        function executeAddTrack(a: ExtractAction<AppAction, 'addTrack'>): void {
            addTrack(a.payload);
        }
);

export const handleAddTrack = createHandler<'addTrack'>({
    execute: executeAddTrack,
    describe: (a) => ({ label: `Add ${a.payload.kind} track "${a.payload.name}"` }),
    undoable: true,
});
