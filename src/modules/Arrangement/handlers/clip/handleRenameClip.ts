import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { renameClip } from '../../useCases/clipEditing/renameClip';
import type { ExtractAction } from '../types';

export const executeRenameClip = inject({ renameClip })(
    ({ renameClip }) =>
        function executeRenameClip(a: ExtractAction<AppAction, 'renameClip'>): void {
            renameClip(a.payload.clipId, a.payload.name);
        }
);

export const handleRenameClip = createHandler<'renameClip'>({
    execute: executeRenameClip,
    describe: (a) => ({ label: `Rename clip to "${a.payload.name}"` }),
    undoable: true,
});
