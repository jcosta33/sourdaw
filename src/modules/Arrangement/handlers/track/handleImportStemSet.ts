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
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';

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

async function reconcileImportedTracks(trackIds: readonly string[]): Promise<void> {
    try {
        await runAllAsyncEffects(trackIds.map((trackId) => () => projectTrackToLiveStrip({ trackId })));
    } catch (error) {
        throw new Error(
            `Imported stem live-strip projection remains incomplete: ${getFailureDetail(error)}. Manual repair required.`,
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
        return {
            status: 'written',
            afterCommit: () =>
                runAllAsyncEffects([
                    ...importedTracks.map((track) => () => projectTrackToLiveStrip({ trackId: track.id })),
                    ...addedTracks.map(
                        (track) => () => publishTrackAdded({ trackId: track.id, name: track.name, kind: track.kind })
                    ),
                ]),
            afterAmbiguousCommit: () => {
                const committedIds = new Set(getTrackStoreState()?.tracks.map((track) => track.id) ?? []);
                return reconcileImportedTracks(
                    importedTracks.filter((track) => committedIds.has(track.id)).map((track) => track.id)
                );
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
    isNoop: (action) => {
        const ids = new Set([action.payload.folderId, ...action.payload.stems.map((stem) => stem.trackId)]);
        return ids.size > 0 && [...ids].every((id) => getTrackStoreState()?.tracks.some((track) => track.id === id));
    },
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
    requiresAbortCompensation: false,
    undoable: false,
});
