import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { copySelectedClip } from '../../useCases/clipboard/copySelectedClip';
import type { ExtractAction } from '../types';

export const executeCopyClip = inject({ copySelectedClip })(
    ({ copySelectedClip }) =>
        function executeCopyClip(_a: ExtractAction<AppAction, 'copyClip'>): void {
            copySelectedClip();
        }
);

export const handleCopyClip = createHandler<'copyClip'>({
    execute: executeCopyClip,
    describe: () => ({ label: 'Copy clip' }),
    undoable: false,
});
