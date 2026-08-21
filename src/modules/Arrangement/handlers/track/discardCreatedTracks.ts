import { createHandler } from '#/utils/createHandler';
import { type HandlerAfterCommit } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

import { handleDiscardCreatedTrack } from './discardCreatedTrack';

export const handleDiscardCreatedTracks = createHandler<'discardCreatedTracks'>({
    execute: (action) => {
        // Someone may have already removed one of the named tracks (e.g. a manual
        // `removeTrack` after the creating command ran). Silently succeeding would leave
        // the inverse's guarantee — remove exactly what was created — unverifiable, so a
        // missing track always conflicts rather than partially discarding the rest.
        const liveTrackIds = new Set(getTrackStoreState()?.tracks.map((track) => track.id) ?? []);
        const hasMissingTrack = action.payload.trackIds.some((trackId) => !liveTrackIds.has(trackId));
        if (hasMissingTrack) {
            return { status: 'conflict' };
        }

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
            afterCommit: () => runAllAsyncEffects(afterCommitEffects),
            afterAmbiguousCommit: () => runAllAsyncEffects(afterAmbiguousCommitEffects),
        };
    },
    describe: () => ({ label: 'Discard created tracks', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
