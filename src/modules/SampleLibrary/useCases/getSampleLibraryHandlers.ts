import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleSearchSamples } from '../handlers/sampleSearch/handleSearchSamples';

type SampleLibraryAppAction = Extract<AppAction, { type: 'searchSamples' }>;

export type SampleLibraryHandlersMap = {
    [Action in SampleLibraryAppAction as Action['type']]: ActionHandler<Action>;
};

/** The SampleLibrary `ActionHandler` map for Command: the library's text search. */
export function getSampleLibraryHandlers(): SampleLibraryHandlersMap {
    return {
        searchSamples: handleSearchSamples,
    };
}
