import { closeElasticEditor } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleCloseElasticEditor = createHandler<'closeElasticEditor'>({
    execute: () => {
        closeElasticEditor();
    },
    describe: () => ({ label: 'Close Elastic Editor' }),
    undoable: false,
});
