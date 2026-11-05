import { createHandler } from '#/utils/createHandler';

import { searchSamples } from '../../useCases/searchSamples';

export const handleSearchSamples = createHandler<'searchSamples'>({
    execute: (alpha) => {
        searchSamples(alpha.payload.query);
    },
    describe: () => ({ label: 'Search Samples' }),
    undoable: false,
});
