import { wireSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { type Track } from '../../models/Track';
import { reconcileRoutingAfterRemovingTracks } from '../../services/reconcileRoutingAfterRemovingTracks';
import { captureTrackRemovalRuntimeAuthority } from '../../useCases/captureTrackRemovalRuntimeAuthority';
import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';

// `removeTrack` refuses the master bus, so "all tracks" never includes it and
// its undo must not try to put the surviving master back.
function getRemovableTracks() {
    return (getTrackStoreState()?.tracks ?? []).filter((track) => track.kind !== 'master');
}

function isRestoreSnapshot(value: RestoreTrackPayloadSnapshot | null): value is RestoreTrackPayloadSnapshot {
    return value !== null;
}

type RoutingPatch = RestoreTrackPayloadSnapshot['routingPatches'][number];

function referencesRemovedTrack(track: Track, removedIds: ReadonlySet<string>): boolean {
    return removedIds.has(track.outputId) || track.sends.some((send) => removedIds.has(send.busId));
}

/**
 * Each per-track snapshot patches a surviving track's routing for removing that
 * one track alone, so no two of them can match the survivor once every track is
 * gone. The survivor's routing is restored once instead: expected is its routing
 * after the whole removal, replacement is its original, and the patch rides on
 * the restore that runs last so every track it points at exists by then.
 */
function restoreSurvivorRoutingOnce(
    restores: readonly RestoreTrackPayloadSnapshot[],
    tracks: readonly Track[],
    removedTrackIds: readonly string[]
): RestoreTrackPayloadSnapshot[] {
    const removedIds = new Set(removedTrackIds);
    const survivors = tracks.filter((track) => !removedIds.has(track.id));
    const survivorIds = new Set(survivors.map((track) => track.id));
    const withoutSurvivorPatches = restores.map((restore) => ({
        ...restore,
        routingPatches: restore.routingPatches.filter((patch) => !survivorIds.has(patch.trackId)),
    }));
    if (survivors.length === 0) {
        return withoutSurvivorPatches;
    }
    const reconciledById = new Map(
        reconcileRoutingAfterRemovingTracks({ removedTrackIds, tracks }).map((track) => [track.id, track])
    );
    const survivorPatches: RoutingPatch[] = survivors.flatMap((survivor) => {
        const reconciled = reconciledById.get(survivor.id);
        if (!reconciled || !referencesRemovedTrack(survivor, removedIds)) {
            return [];
        }
        return [
            structuredClone({
                trackId: survivor.id,
                expected: { outputId: reconciled.outputId, sends: reconciled.sends },
                replacement: { outputId: survivor.outputId, sends: survivor.sends },
            }),
        ];
    });
    const lastRestore = withoutSurvivorPatches.reduce<RestoreTrackPayloadSnapshot | null>(
        (latest, restore) => (latest === null || restore.trackIndex > latest.trackIndex ? restore : latest),
        null
    );
    return withoutSurvivorPatches.map((restore) =>
        restore === lastRestore
            ? { ...restore, routingPatches: [...restore.routingPatches, ...survivorPatches] }
            : restore
    );
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
                        ].map((effect) => runtimeAuthority.guard<void | Promise<void>>(effect))
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
        const tracks = getRemovableTracks();
        if (tracks.length === 0) {
            return { label: 'Remove all tracks', inverseAction: null };
        }
        const captured = tracks.map((track) => captureTrackRemovalSnapshot(track.id)).filter(isRestoreSnapshot);
        const restores = restoreSurvivorRoutingOnce(
            captured,
            getTrackStoreState()?.tracks ?? [],
            tracks.map((track) => track.id)
        );
        return {
            label: 'Remove all tracks',
            inverseAction: { type: 'restoreTracks', payload: { restores } },
            redoAction: alpha,
        };
    },
    isNoop: () => getRemovableTracks().length === 0,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
