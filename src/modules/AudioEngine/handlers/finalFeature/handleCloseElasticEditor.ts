import { createHandler } from '#/utils/createHandler';

import { closeElasticEditor } from '../../useCases/elasticAudio/closeElasticEditor';

export const handleCloseElasticEditor = createHandler<'closeElasticEditor'>({
    execute: () => {
        closeElasticEditor();
    },
    describe: () => ({ label: 'Close Elastic Editor' }),
    undoable: false,
});
