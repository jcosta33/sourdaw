import { createHandler } from '#/utils/createHandler';

import { saveTrackAsTemplate } from '../../useCases/trackTemplate';

export const handleSaveTrackTemplate = createHandler<'saveTrackTemplate'>({
    execute: (alpha) => {
        saveTrackAsTemplate(alpha.payload.trackId, alpha.payload.name, alpha.payload.category);
    },
    describe: () => ({ label: 'Save Track Template' }),
    undoable: false,
});
