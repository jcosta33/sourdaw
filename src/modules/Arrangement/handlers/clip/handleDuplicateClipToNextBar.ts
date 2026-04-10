import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';
import type { ExtractAction } from '../types';

export const executeDuplicateClipToNextBar = inject({ duplicateClipToNextBar })(
    ({ duplicateClipToNextBar }) =>
        function executeDuplicateClipToNextBar(a: ExtractAction<AppAction, 'duplicateClipToNextBar'>): void {
            duplicateClipToNextBar(a.payload.clipId);
        }
);

export const handleDuplicateClipToNextBar = createHandler<'duplicateClipToNextBar'>({
    execute: executeDuplicateClipToNextBar,
    describe: () => ({ label: 'Duplicate clip to next bar' }),
    undoable: true,
});
