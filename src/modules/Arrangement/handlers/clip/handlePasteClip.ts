import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { pasteClip } from '../../useCases/clipboard/pasteClip';
import type { ExtractAction } from '../types';

export const executePasteClip = inject({ pasteClip })(
    ({ pasteClip }) =>
        function executePasteClip(_a: ExtractAction<AppAction, 'pasteClip'>): void {
            pasteClip();
        }
);

export const handlePasteClip = createHandler<'pasteClip'>({
    execute: executePasteClip,
    describe: () => ({ label: 'Paste clip' }),
    undoable: true,
});
