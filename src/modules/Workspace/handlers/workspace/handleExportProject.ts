import { createHandler } from '#/utils/createHandler';
import { exportProjectFile } from '#/modules/Project/useCases';

export const handleExportProject = createHandler<'exportProject'>({
    execute: () => {
        exportProjectFile();
    },
    describe: () => ({ label: 'Export project file' }),
    undoable: false,
});
