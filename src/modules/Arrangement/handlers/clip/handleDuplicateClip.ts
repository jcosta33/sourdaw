import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { duplicateClip } from '../../useCases/clip/duplicateClip';
import type { ExtractAction } from '../types';

export const executeDuplicateClip = inject({ duplicateClip })(
    ({ duplicateClip }) =>
        function executeDuplicateClip(a: ExtractAction<AppAction, 'duplicateClip'>): void {
            duplicateClip(a.payload.clipId);
        }
);

export const handleDuplicateClip = createHandler<'duplicateClip'>({
    execute: executeDuplicateClip,
    describe: () => ({ label: 'Duplicate clip' }),
    undoable: true,
});
