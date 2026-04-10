import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { createFolder } from '#/modules/Arrangement/useCases/folder';
import type { ExtractAction } from '../types';

const executeCreateFolder = inject({ createFolder })(
    ({ createFolder }) =>
        function executeCreateFolder(a: ExtractAction<AppAction, 'createFolder'>): void {
            createFolder(a.payload.name);
        }
);

export const handleCreateFolder = createHandler<'createFolder'>({
    execute: executeCreateFolder,
    describe: (a) => ({ label: `Create folder "${a.payload.name}"` }),
    undoable: true,
});
