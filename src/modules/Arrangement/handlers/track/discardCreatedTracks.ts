import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerAfterCommit } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { captureTrackRemovalRuntimeAuthority } from '../../useCases/captureTrackRemovalRuntimeAuthority';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';

import { handleDiscardCreatedTrack } from './discardCreatedTrack';
import { recordDiscardedPluginStates } from './discardedPluginStateCarry';

type DiscardCreatedTracksAction = Extract<AppAction, { type: 'discardCreatedTracks' }>;
type DiscardCreatedTrackAction = Extract<AppAction, { type: 'discardCreatedTrack' }>;

/**
 * One singular discard per named track, each carrying its own guard. Null when the
 * guards do not name every track exactly once, which no producer emits. An entry
 * recorded before the guards existed carries none and discards by id alone.
 */
function toGuardedDiscards(action: DiscardCreatedTracksAction): DiscardCreatedTrackAction[] | null {
    const { trackIds, generatedMidiStateGuards } = action.payload;
    if (generatedMidiStateGuards === undefined) {
        return trackIds.map((trackId) => ({ type: 'discardCreatedTrack', payload: { trackId } }));
    }
    // Distinct ids, one guard per id and equal lengths make the guards name the tracks one-to-one.
    if (generatedMidiStateGuards.length !== trackIds.length || new Set(trackIds).size !== trackIds.length) {
        return null;
    }
    const discards: DiscardCreatedTrackAction[] = [];
    for (const trackId of trackIds) {
        const guards = generatedMidiStateGuards.filter((guard) => guard.trackId === trackId);
        const guard = guards.length === 1 ? guards[0] : undefined;
        if (guard === undefined) {
            return null;
        }
        discards.push({
            type: 'discardCreatedTrack',
            payload: { trackId, generatedMidiStateGuard: guard.generatedMidiStateGuard },
        });
    }
    return discards;
}

function isGuardCurrent(discard: DiscardCreatedTrackAction): boolean {
    const guard = discard.payload.generatedMidiStateGuard;
    return (
        guard === undefined ||
        isGeneratedMidiStateCurrent({ entityId: discard.payload.trackId, entityType: 'track', guard })
    );
}

export const handleDiscardCreatedTracks = createHandler<'discardCreatedTracks'>({
    validate: (action, context) => {
        const discards = toGuardedDiscards(action);
        return (
            discards !== null &&
            discards.every((discard) => handleDiscardCreatedTrack.validate?.(discard, context) ?? true)
        );
    },
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
        // Every guard is checked before anything is removed: a collaborator's edit to any
        // one created track refuses the whole discard and leaves every track in place.
        const discards = toGuardedDiscards(action);
        if (discards === null || !discards.every(isGuardCurrent)) {
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
