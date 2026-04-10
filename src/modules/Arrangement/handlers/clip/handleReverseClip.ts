import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import type { ExtractAction } from '../types';

export const executeReverseClip = inject({ reverseClip })(
    ({ reverseClip }) =>
        function executeReverseClip(a: ExtractAction<AppAction, 'reverseClip'>): void {
            reverseClip(a.payload.clipId);
        }
);

export const handleReverseClip = createHandler<'reverseClip'>({
    execute: executeReverseClip,
    describe: () => ({ label: 'Reverse clip' }),
    undoable: true,
});
