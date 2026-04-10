import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { addClip } from '../../useCases/clip/addClip';
import type { ExtractAction } from '../types';

export const executeAddClip = inject({ addClip })(
    ({ addClip }) =>
        function executeAddClip(a: ExtractAction<AppAction, 'addClip'>): void {
            addClip(a.payload);
        }
);

export const handleAddClip = createHandler<'addClip'>({
    execute: executeAddClip,
    describe: (a) => ({ label: `Add clip "${a.payload.name}"` }),
    undoable: true,
});
