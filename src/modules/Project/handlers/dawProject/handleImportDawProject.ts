import { createHandler } from '#/utils/createHandler';

import { pickAndImportDawProject } from '../../useCases/dawProject/pickAndImportDawProject';

export const handleImportDawProject = createHandler<'importDawProject'>({
    execute: async () => {
        await pickAndImportDawProject();
    },
    describe: () => ({ label: 'Import DAWproject' }),
    undoable: false,
});
