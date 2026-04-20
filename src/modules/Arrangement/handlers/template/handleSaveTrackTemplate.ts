import { createHandler } from '#/utils/createHandler';

import { saveTrackAsTemplate } from '../../useCases/trackTemplate';

export const handleSaveTrackTemplate = createHandler<'saveTrackTemplate'>({
    execute: (a) => {
        saveTrackAsTemplate(a.payload.trackId, a.payload.name, a.payload.category);
    },
    describe: () => ({ label: 'Save Track Template' }),
    undoable: false,
});
