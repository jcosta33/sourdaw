import { createHandler } from '#/utils/createHandler';

import { openElasticEditor } from '../../useCases/elasticAudio/openElasticEditor';

export const handleOpenElasticEditor = createHandler<'openElasticEditor'>({
    execute: (a) => {
        openElasticEditor(a.payload.clipId);
    },
    describe: () => ({ label: 'Open Elastic Editor' }),
    undoable: false,
});
