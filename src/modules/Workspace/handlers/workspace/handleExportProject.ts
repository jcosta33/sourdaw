import { exportProjectFile } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleExportProject = createHandler<'exportProject'>({
    execute: () => {
        exportProjectFile();
    },
    describe: () => ({ label: 'Export project file' }),
    undoable: false,
});
