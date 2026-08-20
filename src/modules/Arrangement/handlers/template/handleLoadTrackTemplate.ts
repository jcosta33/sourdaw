import { createHandler } from '#/utils/createHandler';

import { loadTrackTemplate } from '../../useCases/loadTrackTemplate';

export const handleLoadTrackTemplate = createHandler<'loadTrackTemplate'>({
    execute: (alpha) => {
        loadTrackTemplate(alpha.payload.templateId);
    },
    describe: () => ({ label: 'Load Track Template' }),
    undoable: false,
});
