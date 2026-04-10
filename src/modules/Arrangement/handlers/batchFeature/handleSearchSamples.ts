import { createHandler } from '#/helpers/createHandler';
import { searchSamples } from '#/modules/SoundLibrary';

export const handleSearchSamples = createHandler<'searchSamples'>({
    execute: (a) => {
        searchSamples(a.payload.query);
    },
    describe: () => ({ label: 'Search Samples' }),
    undoable: false,
});
