import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { cutSelectedClip } from '../../useCases/clipboard/cutSelectedClip';
import type { ExtractAction } from '../types';

export const executeCutClip = inject({ cutSelectedClip })(
    ({ cutSelectedClip }) =>
        function executeCutClip(_a: ExtractAction<AppAction, 'cutClip'>): void {
            cutSelectedClip();
        }
);

export const handleCutClip = createHandler<'cutClip'>({
    execute: executeCutClip,
    describe: () => ({ label: 'Cut clip' }),
    undoable: true,
});
