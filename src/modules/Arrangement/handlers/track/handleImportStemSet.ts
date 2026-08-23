import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';
import { runAllAsyncEffects } from '#/utils/runEffects';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectTrackToLiveStrip } from '../../useCases/projectTrackToLiveStrip';
import { publishTrackAdded } from '../../useCases/publishTrackAdded';
import { publishTrackRemoved } from '../../useCases/publishTrackRemoved';
import { removeTrack } from '../../useCases/removeTrack';
import { importStemSetToProject } from '../../useCases/stemImport/importStemSetToProject';
import { isImportedStemSetApplied } from '../../useCases/stemImport/isImportedStemSetApplied';
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';

import type { Track } from '../../stores/trackStore';

const pendingGuards = new WeakMap<
    object,
    Array<{ trackId: string; generatedMidiStateGuard: GeneratedMidiStateGuard }>
>();

function getFailureDetail(error: unknown): string {
    if (error instanceof AggregateError) {
        return error.errors.map((entry) => getFailureDetail(entry)).join('; ');
    }
    return error instanceof Error ? error.message : String(error);
}

type ReconcileImportedStemEffectsInput = {
    addedTracks: readonly Track[];
    importedTracks: readonly Track[];
    projectedTrackIds: Set<string>;
    publishedTrackIds: Set<string>;
    assetLeaseIds: readonly string[];
    promotedAssetLeaseIds: Set<string>;
    committedTrackIds?: ReadonlySet<string>;
};

async function reconcileImportedStemEffects({
    addedTracks,
    importedTracks,
    projectedTrackIds,
    publishedTrackIds,
    assetLeaseIds,
    promotedAssetLeaseIds,
    committedTrackIds,
}: ReconcileImportedStemEffectsInput): Promise<void> {
    const isCommitted = (trackId: string) => !committedTrackIds || committedTrackIds.has(trackId);
    try {
        await runAllAsyncEffects([
            ...assetLeaseIds
                .filter((leaseId) => !promotedAssetLeaseIds.has(leaseId))
                .map((leaseId) => () => {
                    const transfer = getAssetTransfer();
                    if (!transfer) {
                        throw new Error(`Asset transfer is unavailable for staged lease: ${leaseId}`);
                    }
                    transfer.promoteStagedAsset(leaseId);
                    promotedAssetLeaseIds.add(leaseId);
                }),
            ...importedTracks
                .filter((track) => isCommitted(track.id) && !projectedTrackIds.has(track.id))
                .map((track) => () => {
                    projectTrackToLiveStrip({ trackId: track.id });
                    projectedTrackIds.add(track.id);
                }),
            ...addedTracks
                .filter((track) => isCommitted(track.id) && !publishedTrackIds.has(track.id))
                .map((track) => async () => {
                    await publishTrackAdded({ trackId: track.id, name: track.name, kind: track.kind });
                    publishedTrackIds.add(track.id);
                }),
        ]);
    } catch (error) {
        throw new Error(
            `Imported stem runtime reconciliation remains incomplete: ${getFailureDetail(error)}. Manual repair required.`,
            { cause: error }
        );
    }
}

export const handleImportStemSet = createHandler<'importStemSet'>({
    execute: (action) => {
        const result = importStemSetToProject(action);
        if (!result) {
            pendingGuards.delete(action);
            return { status: 'conflict' };
        }
        const { folder, importedTracks } = result;

        const guards = pendingGuards.get(action);
        if (guards) {
            for (const entry of guards) {
                const created =
                    entry.trackId === folder.id ? folder : importedTracks.find((track) => track.id === entry.trackId);
                if (created) {
                    entry.generatedMidiStateGuard.entityJson = JSON.stringify(created);
                    entry.generatedMidiStateGuard.midiByClipIdJson = serializeMidiStateForClips(
                        created.clips.map((clip) => clip.id)
                    );
                }
            }
        }
        pendingGuards.delete(action);

        const addedTracks = [folder, ...importedTracks];
        const assetLeaseIds = action.payload.stems.flatMap((stem) => (stem.assetLeaseId ? [stem.assetLeaseId] : []));
        const projectedTrackIds = new Set<string>();
        const publishedTrackIds = new Set<string>();
        const promotedAssetLeaseIds = new Set<string>();
        const reconcile = (committedTrackIds?: ReadonlySet<string>) =>
            reconcileImportedStemEffects({
                addedTracks,
                importedTracks,
                projectedTrackIds,
                publishedTrackIds,
                assetLeaseIds,
                promotedAssetLeaseIds,
                committedTrackIds,
            });
        return {
            status: 'written',
            afterCommit: () => reconcile(),
            afterAmbiguousCommit: () => {
                const committedIds = new Set(getTrackStoreState()?.tracks.map((track) => track.id) ?? []);
                return reconcile(committedIds);
            },
        };
    },
    describe: (action) => {
        const guards = [action.payload.folderId, ...action.payload.stems.map((stem) => stem.trackId)].map(
            (trackId) => ({
                trackId,
                generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '{}' },
            })
        );
        pendingGuards.set(action, guards);
        return {
            label: `Import ${String(action.payload.stems.length)} stems into folder "${action.payload.groupName}"`,
            inverseAction: {
                type: 'discardImportedStemSet',
                payload: {
                    folderId: action.payload.folderId,
                    stemTrackIds: action.payload.stems.map((stem) => stem.trackId),
                    guards,
                },
            },
            redoAction: action,
        };
    },
    isNoop: isImportedStemSetApplied,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});

export const handleDiscardImportedStemSet = createHandler<'discardImportedStemSet'>({
    execute: (action) => {
        const allowedChildren = action.payload.stemTrackIds;
        const guardsValid = action.payload.guards.every((entry) =>
            isGeneratedMidiStateCurrent({
                entityId: entry.trackId,
                entityType: 'track',
                guard: entry.generatedMidiStateGuard,
                ...(entry.trackId === action.payload.folderId ? { allowedReferencingTrackIds: allowedChildren } : {}),
            })
        );
        if (!guardsValid) {
            return { status: 'conflict' };
        }

        const orderedIds = [...action.payload.stemTrackIds, action.payload.folderId];
        const removals = orderedIds.map((trackId) => ({
            trackId,
            result: removeTrack(trackId, { deferRuntimeEffects: true, suppressRemovedEvent: true }),
        }));
        if (removals.some(({ result }) => !result.removed)) {
            return { status: 'conflict' };
        }
        const completedRemovals = removals.flatMap(({ trackId, result }) =>
            result.removed ? [{ trackId, finalizeRuntimeRemoval: result.finalizeRuntimeRemoval }] : []
        );
        const finalize = () =>
            runAllAsyncEffects(
                completedRemovals.flatMap(({ trackId, finalizeRuntimeRemoval }) => [
                    finalizeRuntimeRemoval,
                    () => publishTrackRemoved({ trackId }),
                ])
            );
        return {
            status: 'written',
            afterCommit: finalize,
            afterAmbiguousCommit: finalize,
        };
    },
    describe: () => ({ label: 'Discard imported stem set' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
