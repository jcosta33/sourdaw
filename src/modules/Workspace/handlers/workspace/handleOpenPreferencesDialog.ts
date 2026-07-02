import { createHandler } from '#/utils/createHandler';

import { openPreferencesDialog } from '../../useCases/dialogs/openPreferencesDialog';

export const handleOpenPreferencesDialog = createHandler<'openPreferencesDialog'>({
    execute: () => {
        openPreferencesDialog();
    },
    describe: () => ({ label: 'Open preferences' }),
    undoable: false,
});
