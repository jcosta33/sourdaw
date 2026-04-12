import { createHandler } from '#/utils/createHandler';
import { loadTrackTemplate } from '../../useCases/trackTemplate';

export const handleLoadTrackTemplate = createHandler<'loadTrackTemplate'>({
    execute: (a) => {
        loadTrackTemplate(a.payload.templateId);
    },
    describe: () => ({ label: 'Load Track Template' }),
    undoable: true,
});
