import { createHandler } from '#/utils/createHandler';

import { deleteTrackTemplate } from '../../useCases/deleteTrackTemplate';

export const handleDeleteTrackTemplate = createHandler<'deleteTrackTemplate'>({
    execute: (alpha) => {
        deleteTrackTemplate(alpha.payload.templateId);
    },
    describe: () => ({ label: 'Delete Track Template' }),
    undoable: false,
});
