import { searchSamples } from '#/modules/SampleLibrary/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSearchSamples = createHandler<'searchSamples'>({
    execute: (alpha) => {
        searchSamples(alpha.payload.query);
    },
    describe: () => ({ label: 'Search Samples' }),
    undoable: false,
});
