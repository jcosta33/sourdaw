import { openElasticEditor } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleOpenElasticEditor = createHandler<'openElasticEditor'>({
    execute: (a) => {
        openElasticEditor(a.payload.clipId);
    },
    describe: () => ({ label: 'Open Elastic Editor' }),
    undoable: false,
});
