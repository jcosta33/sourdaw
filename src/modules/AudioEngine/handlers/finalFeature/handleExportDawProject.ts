import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';

export const handleExportDawProject = createHandler<'exportDawProject'>({
    execute: () => {
        notifyUser('DAWproject export — use File > Export DAWproject for full export');
    },
    describe: () => ({ label: 'Export DAWproject' }),
    undoable: false,
});
