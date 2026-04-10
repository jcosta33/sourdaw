import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { setClipLoop } from '../../useCases/clipLoop';
import type { ExtractAction } from '../types';

export const executeSetClipLoop = inject({ setClipLoop })(
    ({ setClipLoop }) =>
        function executeSetClipLoop(a: ExtractAction<AppAction, 'setClipLoop'>): void {
            setClipLoop(a.payload.clipId, a.payload.enabled);
        }
);

export const handleSetClipLoop = createHandler<'setClipLoop'>({
    execute: executeSetClipLoop,
    describe: (a) => ({ label: a.payload.enabled ? 'Enable clip loop' : 'Disable clip loop' }),
    undoable: true,
});
