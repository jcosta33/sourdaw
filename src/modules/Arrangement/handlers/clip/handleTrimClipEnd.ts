import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';
import type { ExtractAction } from '../types';

export const executeTrimClipEnd = inject({ trimClipEnd })(
    ({ trimClipEnd }) =>
        function executeTrimClipEnd(a: ExtractAction<AppAction, 'trimClipEnd'>): void {
            trimClipEnd(a.payload.clipId, a.payload.newEndBeat);
        }
);

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    execute: executeTrimClipEnd,
    describe: () => ({ label: 'Trim clip end' }),
    undoable: true,
});
