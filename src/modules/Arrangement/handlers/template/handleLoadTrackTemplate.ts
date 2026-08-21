import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { loadTrackTemplate } from '../../useCases/loadTrackTemplate';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type MutableDescribeResult = {
    label: string;
    inverseAction: AppAction | null;
};

// A template can append zero, one, or several tracks and none of their ids are
// materialized in advance — unlike `createFolder`'s single id, there is nothing
// `describe()` can name up front. It registers a mutable holder before `execute()` runs;
// `execute()` diffs the track store before and after the write and fills the holder in.
// `executeAppAction` re-reads the exact object `describe()` returned, after `execute()`
// completes, to build the undo entry — the same describe-then-finalize pattern
// `handleFreezeTrack` uses for its post-render snapshot.
const pendingDescribeResults = new WeakMap<object, MutableDescribeResult>();

export const handleLoadTrackTemplate = createHandler<'loadTrackTemplate'>({
    execute: (alpha) => {
        const beforeIds = new Set(getTrackStoreState()?.tracks.map((track) => track.id) ?? []);
        loadTrackTemplate(alpha.payload.templateId);
        const createdTrackIds = (getTrackStoreState()?.tracks ?? [])
            .map((track) => track.id)
            .filter((trackId) => !beforeIds.has(trackId));

        const pending = pendingDescribeResults.get(alpha);
        if (pending) {
            pending.inverseAction =
                createdTrackIds.length > 0
                    ? { type: 'discardCreatedTracks', payload: { trackIds: createdTrackIds } }
                    : null;
        }
        return toHandlerExecutionResult(createdTrackIds.length > 0);
    },
    describe: (alpha) => {
        const result: MutableDescribeResult = { label: 'Load Track Template', inverseAction: null };
        pendingDescribeResults.set(alpha, result);
        return result;
    },
    undoable: true,
});
