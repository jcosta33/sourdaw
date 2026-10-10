import { wireSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { captureTrackRemovalRuntimeAuthority } from '../../useCases/captureTrackRemovalRuntimeAuthority';
import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';

function isRestoreSnapshot(value: RestoreTrackPayloadSnapshot | null): value is RestoreTrackPayloadSnapshot {
    return value !== null;
}

export const handleRemoveAllTracks = createHandler<'removeAllTracks'>({
    execute: () => {
        const state = getTrackStoreState();
        if (!state || state.tracks.length === 0) {
            return { status: 'no-write' };
        }
        const runtimeAuthority = captureTrackRemovalRuntimeAuthority();
        const removals: Array<{
            trackId: string;
            finalizeRuntimeRemoval: () => void;
            modulationRemoval: ReturnType<typeof removeTrackModulationReferences>;
        }> = [];
        for (const track of state.tracks) {
            const result = removeTrack(track.id, {
                deferRuntimeEffects: true,
                suppressRemovedEvent: true,
            });
            if (result.removed) {
                removals.push({
                    trackId: track.id,
                    finalizeRuntimeRemoval: result.finalizeRuntimeRemoval,
                    modulationRemoval: removeTrackModulationReferences({
                        trackId: track.id,
                        deferRuntimeEffects: true,
                    }),
                });
            }
        }
        if (removals.length === 0) {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: () =>
                runAllAsyncEffects(
                    removals.flatMap(({ trackId, finalizeRuntimeRemoval, modulationRemoval }) =>
                        [
                            runtimeAuthority.guardAbsent(trackId, finalizeRuntimeRemoval),
                            modulationRemoval.afterCommit,
                            runtimeAuthority.guardAbsent(trackId, () => publishTrackRemoved({ trackId })),
                        ].map((effect) => runtimeAuthority.guard(effect))
                    )
                ),
            afterAmbiguousCommit: () => {
                if (!runtimeAuthority.isCurrent()) {
                    return undefined;
                }
                const committedState = getTrackStoreState();
                if (!committedState) {
                    throw new Error('Committed track state is unavailable; manual repair required');
                }
                const committedIds = new Set(committedState.tracks.map((track) => track.id));
                const effects: Array<() => void | Promise<void>> = [];
                for (const { trackId, finalizeRuntimeRemoval, modulationRemoval } of removals) {
                    if (committedIds.has(trackId)) {
                        effects.push(() => {
                            projectTrackToLiveStrip({ trackId, activateDormantExternalPlugins: true });
                        });
                    } else {
                        effects.push(
                            runtimeAuthority.guardAbsent(trackId, finalizeRuntimeRemoval),
                            runtimeAuthority.guardAbsent(trackId, () => publishTrackRemoved({ trackId }))
                        );
                    }
                    effects.push(modulationRemoval.afterAmbiguousCommit);
                }
                effects.push(() => wireSidechainRoutes());
                return runAllAsyncEffects(effects.map(runtimeAuthority.guard));
            },
            postCommitEffect: { kind: 'external-effect', remediation: 'manual-repair' },
        };
    },
    describe: (alpha) => {
        // Capture every live track before execute deletes them, in track order, so the
        // whole arrangement comes back as one undo unit rather than N separate undos.
        const tracks = getTrackStoreState()?.tracks ?? [];
        if (tracks.length === 0) {
            return { label: 'Remove all tracks', inverseAction: null };
        }
        const restores = tracks.map((track) => captureTrackRemovalSnapshot(track.id)).filter(isRestoreSnapshot);
        return {
            label: 'Remove all tracks',
            inverseAction: { type: 'restoreTracks', payload: { restores } },
            redoAction: alpha,
        };
    },
    isNoop: () => (getTrackStoreState()?.tracks.length ?? 0) === 0,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
