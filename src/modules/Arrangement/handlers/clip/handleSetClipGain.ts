import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { setClipGain } from '../../useCases/clipEditing/setClipGain';
import type { ExtractAction } from '../types';

export const executeSetClipGain = inject({ setClipGain })(
    ({ setClipGain }) =>
        function executeSetClipGain(a: ExtractAction<AppAction, 'setClipGain'>): void {
            setClipGain(a.payload.clipId, a.payload.gain);
        }
);

export const handleSetClipGain = createHandler<'setClipGain'>({
    execute: executeSetClipGain,
    describe: () => ({ label: 'Set clip gain' }),
    undoable: true,
});
