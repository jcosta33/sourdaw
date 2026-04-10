import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { normalizeClip } from '../../useCases/clipEditing/normalizeClip';
import type { ExtractAction } from '../types';

export const executeNormalizeClip = inject({ normalizeClip })(
    ({ normalizeClip }) =>
        function executeNormalizeClip(a: ExtractAction<AppAction, 'normalizeClip'>): void {
            normalizeClip(a.payload.clipId, a.payload.mode, a.payload.targetDb);
        }
);

export const handleNormalizeClip = createHandler<'normalizeClip'>({
    execute: executeNormalizeClip,
    describe: (a) => ({ label: `Normalize clip (${a.payload.mode ?? 'peak'})` }),
    undoable: true,
});
