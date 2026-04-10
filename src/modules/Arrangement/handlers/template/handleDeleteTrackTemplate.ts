import { createHandler } from '#/helpers/createHandler';
import { deleteTrackTemplate } from '../../useCases/trackTemplate';

export const handleDeleteTrackTemplate = createHandler<'deleteTrackTemplate'>({
    execute: (a) => {
        deleteTrackTemplate(a.payload.templateId);
    },
    describe: () => ({ label: 'Delete Track Template' }),
    undoable: false,
});
