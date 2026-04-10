import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { renameTrack } from '#/modules/Arrangement/useCases/renameTrack';
import type { ExtractAction } from '../types';

const executeRenameTrack = inject({ renameTrack })(
    ({ renameTrack }) =>
        function executeRenameTrack(a: ExtractAction<AppAction, 'renameTrack'>): void {
            renameTrack(a.payload.trackId, a.payload.name);
        }
);

export const handleRenameTrack = createHandler<'renameTrack'>({
    execute: executeRenameTrack,
    describe: (a) => ({ label: `Rename track to "${a.payload.name}"` }),
    undoable: true,
});
