import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import type { ExtractAction } from '../types';

export const executeTrimClipStart = inject({ trimClipStart })(
    ({ trimClipStart }) =>
        function executeTrimClipStart(a: ExtractAction<AppAction, 'trimClipStart'>): void {
            trimClipStart(a.payload.clipId, a.payload.newStartBeat);
        }
);

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: executeTrimClipStart,
    describe: () => ({ label: 'Trim clip start' }),
    undoable: true,
});
