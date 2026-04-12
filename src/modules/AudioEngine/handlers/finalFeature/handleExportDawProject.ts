import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleExportDawProject = createHandler<'exportDawProject'>({
    execute: () => {
        notifyUser('DAWproject export — use File > Export DAWproject for full export');
    },
    describe: () => ({ label: 'Export DAWproject' }),
    undoable: false,
});
