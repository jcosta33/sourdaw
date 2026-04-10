import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { splitClip } from '../../useCases/clipEditing/splitClip';
import type { ExtractAction } from '../types';

export const executeSplitClip = inject({ splitClip })(
    ({ splitClip }) =>
        function executeSplitClip(a: ExtractAction<AppAction, 'splitClip'>): void {
            splitClip(a.payload.clipId, a.payload.beat);
        }
);

export const handleSplitClip = createHandler<'splitClip'>({
    execute: executeSplitClip,
    describe: () => ({ label: 'Split clip' }),
    undoable: true,
});
