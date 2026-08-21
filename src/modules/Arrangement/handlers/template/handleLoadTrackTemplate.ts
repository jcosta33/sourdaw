import { createHandler } from '#/utils/createHandler';
import { type AppAction, type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';

import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { loadTrackTemplate } from '../../useCases/loadTrackTemplate';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type MutableDescribeResult = {
    label: string;
    inverseAction: AppAction | null;
    redoAction?: AppAction;
};

// A template can append zero, one, or several tracks and none of their ids are
// materialized in advance — unlike `createFolder`'s single id, there is nothing
// `describe()` can name up front. It registers a mutable holder before `execute()` runs;
// `execute()` diffs the track store before and after the write and fills the holder in.
// `executeAppAction` re-reads the exact object `describe()` returned, after `execute()`
// completes, to build the undo entry — the same describe-then-finalize pattern
// `handleFreezeTrack` uses for its post-render snapshot.
const pendingDescribeResults = new WeakMap<object, MutableDescribeResult>();

function isRestoreSnapshot(value: RestoreTrackPayloadSnapshot | null): value is RestoreTrackPayloadSnapshot {
    return value !== null;
}

export const handleLoadTrackTemplate = createHandler<'loadTrackTemplate'>({
    execute: (alpha) => {
        const beforeIds = new Set(getTrackStoreState()?.tracks.map((track) => track.id) ?? []);
        loadTrackTemplate(alpha.payload.templateId);
        const createdTrackIds = (getTrackStoreState()?.tracks ?? [])
            .map((track) => track.id)
            .filter((trackId) => !beforeIds.has(trackId));

        // Redo must reproduce *these* tracks, not run the template again: every id the
        // template mints — the track's, each device's, the initial alternative's — is a
        // fresh `crypto.randomUUID()`, so replaying `loadTrackTemplate` appends different
        // tracks while the undo entry still names the first run's. The inverse would then
        // conflict forever on ids nothing holds, pinning the entry at the top of `past`
        // and burying every older entry under it. Restoring the captured tracks by id is
        // what `handleConsolidateAllTracks` and `handleFreezeTrack` do for the same reason.
        const restores = createdTrackIds
            .map((trackId) => captureTrackRemovalSnapshot(trackId))
            .filter(isRestoreSnapshot);

        const pending = pendingDescribeResults.get(alpha);
        if (pending) {
            // Inverse and redo are emitted together or not at all. A snapshot that came
            // back `null` means a created track was already gone, and an inverse naming
            // ids no redo can reproduce is exactly the wedge above; an inert entry that
            // undo drops is the safe degradation.
            const captured = restores.length > 0 && restores.length === createdTrackIds.length;
            pending.inverseAction = captured
                ? { type: 'discardCreatedTracks', payload: { trackIds: createdTrackIds } }
                : null;
            pending.redoAction = captured ? { type: 'restoreTracks', payload: { restores } } : undefined;
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
