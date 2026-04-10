import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { setClipColor } from '../../useCases/clipEditing/setClipColor';
import type { ExtractAction } from '../types';

export const executeSetClipColor = inject({ setClipColor })(
    ({ setClipColor }) =>
        function executeSetClipColor(a: ExtractAction<AppAction, 'setClipColor'>): void {
            setClipColor(a.payload.clipId, a.payload.color);
        }
);

export const handleSetClipColor = createHandler<'setClipColor'>({
    execute: executeSetClipColor,
    describe: () => ({ label: 'Set clip color' }),
    undoable: true,
});
