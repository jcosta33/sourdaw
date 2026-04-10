import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { lockClip } from '../../useCases/clipEditing/lockClip';
import type { ExtractAction } from '../types';

export const executeLockClip = inject({ lockClip })(
    ({ lockClip }) =>
        function executeLockClip(a: ExtractAction<AppAction, 'lockClip'>): void {
            lockClip(a.payload.clipId, a.payload.locked);
        }
);

export const handleLockClip = createHandler<'lockClip'>({
    execute: executeLockClip,
    describe: (a) => ({ label: a.payload.locked ? 'Lock clip' : 'Unlock clip' }),
    undoable: true,
});
