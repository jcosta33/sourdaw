import { wireSidechainRoutes } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { removeTrackModulationReferences } from '../../useCases/removeTrackModulationReferences';

type RemoveTrackAction = Extract<AppAction, { type: 'removeTrack' }>;

function currentStateMatches(action: RemoveTrackAction): boolean {
    const currentTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
    const hasStateGuard =
        action.payload.expectedKind !== undefined ||
        action.payload.expectedMuted !== undefined ||
        action.payload.expectedClipIds !== undefined ||
        action.payload.expectedAlternativeClipIds !== undefined ||
        action.payload.expectedVcaGroupId !== undefined ||
        action.payload.expectedVcaMembershipGroupIds !== undefined;
    if (!currentTrack) {
        return !hasStateGuard;
    }
    if (action.payload.expectedKind !== undefined && currentTrack.kind !== action.payload.expectedKind) {
        return false;
    }
    if (action.payload.expectedMuted !== undefined && currentTrack.muted !== action.payload.expectedMuted) {
        return false;
    }
    if (action.payload.expectedClipIds !== undefined) {
        const currentClipIds = currentTrack.clips.map((clip) => clip.id);
        if (
            currentClipIds.length !== action.payload.expectedClipIds.length ||
            currentClipIds.some((clipId, index) => clipId !== action.payload.expectedClipIds?.[index])
        ) {
            return false;
        }
    }
    if (action.payload.expectedAlternativeClipIds !== undefined) {
        const currentAlternativeClipIds = currentTrack.alternatives.flatMap((alternative) =>
            alternative.clips.map((clip) => clip.id)
        );
        if (
            currentAlternativeClipIds.length !== action.payload.expectedAlternativeClipIds.length ||
            currentAlternativeClipIds.some(
                (clipId, index) => clipId !== action.payload.expectedAlternativeClipIds?.[index]
            )
        ) {
            return false;
        }
    }
    if (
        action.payload.expectedVcaGroupId !== undefined &&
        (currentTrack.vcaGroupId ?? null) !== action.payload.expectedVcaGroupId
    ) {
        return false;
    }
    if (action.payload.expectedVcaMembershipGroupIds !== undefined) {
        const currentVcaMembershipGroupIds = getVcaGroupsState()
            .filter((group) => group.trackIds.includes(action.payload.trackId))
            .map((group) => group.id)
            .sort();
        const expectedVcaMembershipGroupIds = [...action.payload.expectedVcaMembershipGroupIds].sort();
        if (
            currentVcaMembershipGroupIds.length !== expectedVcaMembershipGroupIds.length ||
            currentVcaMembershipGroupIds.some((groupId, index) => groupId !== expectedVcaMembershipGroupIds[index])
        ) {
            return false;
        }
    }
    return true;
}

export const handleRemoveTrack = createHandler<'removeTrack'>({
    validate: (action) => currentStateMatches(action),
    execute: (action) => {
        if (!currentStateMatches(action)) {
            return { status: 'conflict' };
        }
        const result = removeTrack(action.payload.trackId, {
            deferRuntimeEffects: true,
            suppressRemovedEvent: true,
        });
        if (!result.removed) {
            return { status: 'no-write' };
        }
        const finalizeModulationRemoval = removeTrackModulationReferences({
            trackId: action.payload.trackId,
            deferRuntimeEffects: true,
        });
        return {
            status: 'written',
            afterCommit: () =>
                runAllAsyncEffects([
                    result.finalizeRuntimeRemoval,
                    finalizeModulationRemoval.afterCommit,
                    () => publishTrackRemoved({ trackId: action.payload.trackId }),
                ]),
            afterAmbiguousCommit: async () => {
                const committedTrack = getTrackStoreState()?.tracks.find(
                    (candidate) => candidate.id === action.payload.trackId
                );
                const effects: Array<() => void | Promise<void>> = [
                    finalizeModulationRemoval.afterAmbiguousCommit,
                    () => wireSidechainRoutes(),
                ];
                if (committedTrack) {
                    effects.unshift(() => {
                        projectTrackToLiveStrip({
                            trackId: committedTrack.id,
                            activateDormantExternalPlugins: true,
                        });
                    });
                } else {
                    effects.unshift(result.finalizeRuntimeRemoval, () =>
                        publishTrackRemoved({ trackId: action.payload.trackId })
                    );
                }
                try {
                    await runAllAsyncEffects(effects);
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    throw new Error(`Track runtime reconciliation failed; manual repair required: ${reason}`, {
                        cause: error,
                    });
                }
            },
        };
    },
    describe: (alpha) => {
        // Snapshot everything that removeTrack will delete, so the inverse
        // action (`restoreTrack`) can replay it. Runs pre-execute.
        const snapshot = captureTrackRemovalSnapshot(alpha.payload.trackId);
        if (!snapshot) {
            return { label: 'Remove track' };
        }
        return {
            label: `Remove track "${snapshot.trackName}"`,
            inverseAction: { type: 'restoreTrack', payload: snapshot },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
