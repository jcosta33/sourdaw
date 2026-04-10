import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { setClipLoopLength } from '../../useCases/clipLoop';
import type { ExtractAction } from '../types';

export const executeSetClipLoopLength = inject({ setClipLoopLength })(
    ({ setClipLoopLength }) =>
        function executeSetClipLoopLength(a: ExtractAction<AppAction, 'setClipLoopLength'>): void {
            setClipLoopLength(a.payload.clipId, a.payload.loopLength);
        }
);

export const handleSetClipLoopLength = createHandler<'setClipLoopLength'>({
    execute: executeSetClipLoopLength,
    describe: () => ({ label: 'Set clip loop length' }),
    undoable: true,
});
