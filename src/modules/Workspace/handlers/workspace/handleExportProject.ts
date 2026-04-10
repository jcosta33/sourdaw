import { createHandler } from '#/helpers/createHandler';
import { exportProjectFile } from '#/modules/Project';

export const handleExportProject = createHandler<'exportProject'>({
    execute: () => {
        exportProjectFile();
    },
    describe: () => ({ label: 'Export project file' }),
    undoable: false,
});
