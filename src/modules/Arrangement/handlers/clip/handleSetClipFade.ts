import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { setClipFade } from '../../useCases/clipEditing/setClipFade';
import type { ExtractAction } from '../types';

export const executeSetClipFade = inject({ setClipFade })(
    ({ setClipFade }) =>
        function executeSetClipFade(a: ExtractAction<AppAction, 'setClipFade'>): void {
            setClipFade(a.payload.clipId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
        }
);

export const handleSetClipFade = createHandler<'setClipFade'>({
    execute: executeSetClipFade,
    describe: () => ({ label: 'Set clip fade' }),
    undoable: true,
});
