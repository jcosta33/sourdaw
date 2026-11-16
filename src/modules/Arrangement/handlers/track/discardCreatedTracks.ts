import { createHandler } from '#/utils/createHandler';
import { type HandlerAfterCommit } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { captureTrackRemovalRuntimeAuthority } from '../../useCases/captureTrackRemovalRuntimeAuthority';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

import { handleDiscardCreatedTrack } from './discardCreatedTrack';
import { recordDiscardedPluginStates } from './discardedPluginStateCarry';

export const handleDiscardCreatedTracks = createHandler<'discardCreatedTracks'>({
    execute: (action, context) => {
        // Someone may have already removed one of the named tracks (e.g. a manual
        // `removeTrack` after the creating command ran). Silently succeeding would leave
        // the inverse's guarantee — remove exactly what was created — unverifiable, so a
        // missing track always conflicts rather than partially discarding the rest.
        const liveTrackIds = new Set(getTrackStoreState()?.tracks.map((track) => track.id) ?? []);
        const hasMissingTrack = action.payload.trackIds.some((trackId) => !liveTrackIds.has(trackId));
        if (hasMissingTrack) {
            return { status: 'conflict' };
        }

        if (context?.undoEntryId !== undefined) {
            const trackIds = new Set(action.payload.trackIds);
            const discarded = getTrackStoreState()?.tracks.filter((track) => trackIds.has(track.id)) ?? [];
            recordDiscardedPluginStates(context.undoEntryId, discarded);
        }

        const runtimeAuthority = captureTrackRemovalRuntimeAuthority();
        const afterCommitEffects: HandlerAfterCommit[] = [];
        const afterAmbiguousCommitEffects: HandlerAfterCommit[] = [];
        for (const trackId of action.payload.trackIds) {
            const result = handleDiscardCreatedTrack.execute({ type: 'discardCreatedTrack', payload: { trackId } });
            if (result instanceof Promise) {
                throw new TypeError('The certified discard-created-track handler returned asynchronously');
            }
            if (result?.status === 'conflict') {
                return { status: 'conflict' };
            }
            if (result?.afterCommit) {
                afterCommitEffects.push(result.afterCommit);
            }
            if (result?.afterAmbiguousCommit) {
                afterAmbiguousCommitEffects.push(result.afterAmbiguousCommit);
            }
        }

        return {
            status: 'written',
            afterCommit: () => runAllAsyncEffects(afterCommitEffects.map(runtimeAuthority.guard)),
            afterAmbiguousCommit: () => runAllAsyncEffects(afterAmbiguousCommitEffects.map(runtimeAuthority.guard)),
        };
    },
    describe: () => ({ label: 'Discard created tracks', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
