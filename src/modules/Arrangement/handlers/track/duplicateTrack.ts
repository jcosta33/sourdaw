import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { type Track } from '../../stores/trackStore';
import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { serializeClipScopedAutomationLanes } from '../../useCases/clip/serializeClipScopedAutomationLanes';
import { activateCreatedTrackHostedPlugins } from '../../useCases/device/activateCreatedTrackHostedPlugins';
import { collectHostedPluginInstances } from '../../useCases/device/collectHostedPluginInstances';
import { duplicateTrack } from '../../useCases/duplicateTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type DuplicateTrackAction = { payload: { trackId: string; targetTrackId?: string; select?: boolean } };
const duplicableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'folder']);

function ensureTargetTrackId(action: DuplicateTrackAction): string {
    if (action.payload.targetTrackId) {
        return action.payload.targetTrackId;
    }
    const targetTrackId = `track-dup-${crypto.randomUUID()}`;
    action.payload.targetTrackId = targetTrackId;
    return targetTrackId;
}

type PendingDuplicateDescription = {
    readonly guard: GeneratedMidiStateGuard;
    readonly result: { label: string; inverseAction: AppAction | null; redoAction?: AppAction };
};

// Describe results for duplicates this handler creates, keyed by action so the
// describe-time inverse and redo are finalized with the created entity once
// execute lands — the handleAddTrack/handleLoadTrackTemplate pattern.
const pendingDuplicateDescriptions = new WeakMap<object, PendingDuplicateDescription>();

/**
 * Finalizes the discard guard from the committed store track: the use case's
 * return value predates its own step that copies devices, sends, and clips,
 * and isGeneratedMidiStateCurrent compares the guard against the store shape.
 * Satellite state copied from the source (clip-scoped automation lanes) makes
 * the comparison fail unless the guard expects exactly what the duplication
 * cloned onto the copies' new clip ids — requiring absence would make the
 * duplicate's own undo conflict on what it itself created.
 *
 * Redo restores this exact copy rather than duplicating again: a fresh
 * duplication re-mints every device, clip and alternative id, so the guard
 * would no longer name what redo made, and would re-copy the source's plugin
 * state over the copy's own. Inverse and redo are emitted together or not at
 * all, as in handleLoadTrackTemplate.
 */
function finalizeDuplicateDescription(pending: PendingDuplicateDescription, committed: Track | undefined): void {
    const restore = committed ? captureTrackRemovalSnapshot(committed.id) : null;
    if (!committed || !restore) {
        pending.result.inverseAction = null;
        pending.result.redoAction = undefined;
        return;
    }
    const clipIds = collectTrackClipIds(committed);
    pending.guard.entityJson = JSON.stringify(committed);
    pending.guard.midiByClipIdJson = serializeMidiStateForClips(clipIds);
    pending.guard.clipAutomationLanesJson = serializeClipScopedAutomationLanes(clipIds);
    pending.result.redoAction = { type: 'restoreTracks', payload: { restores: [restore] } };
}

export const handleDuplicateTrack = createHandler<'duplicateTrack'>({
    materializeCommandArguments: (action) => {
        ensureTargetTrackId(action);
    },
    execute: (action) => {
        const tracks = getTrackStoreState()?.tracks;
        const source = tracks?.find((track) => track.id === action.payload.trackId);
        if (!source || !duplicableTrackKinds.has(source.kind)) {
            return { status: 'conflict' };
        }
        const options: {
            select?: boolean;
            targetTrackId: string;
        } = {
            targetTrackId: ensureTargetTrackId(action),
        };
        if (action.payload.select !== undefined) {
            options.select = action.payload.select;
        }
        const track = duplicateTrack(action.payload.trackId, options);
        if (!track) {
            return { status: 'conflict' };
        }
        // The use case's return value predates its own device copy; the store holds the committed track.
        const committed = getTrackStoreState()?.tracks.find((candidate) => candidate.id === track.id);
        const pending = pendingDuplicateDescriptions.get(action);
        if (pending) {
            finalizeDuplicateDescription(pending, committed);
        }
        if (!committed || collectHostedPluginInstances(committed).length === 0) {
            return { status: 'written' };
        }
        const activate = () => activateCreatedTrackHostedPlugins(track.id);
        return { status: 'written', afterCommit: activate, afterAmbiguousCommit: activate };
    },
    describe: (action) => {
        const targetTrackId = ensureTargetTrackId(action);
        const tracks = getTrackStoreState()?.tracks;
        const source = tracks?.find((track) => track.id === action.payload.trackId);
        const sourceIsDuplicable = source ? duplicableTrackKinds.has(source.kind) : false;
        const targetExists = tracks?.some((track) => track.id === targetTrackId) ?? true;
        if (!sourceIsDuplicable || targetExists) {
            return { label: 'Duplicate track', inverseAction: null };
        }
        // The guard makes the discard inverse reapply-safe inside atomic
        // batches (discardCreatedTrack's canReapplyAfterDivergence requires
        // it) — same pattern as handleAddTrack. Execute finalizes entityJson
        // once the duplicate lands.
        const generatedMidiStateGuard = {
            entityJson: '',
            midiByClipIdJson: JSON.stringify({}),
        };
        const result: PendingDuplicateDescription['result'] = {
            label: 'Duplicate track',
            inverseAction: {
                type: 'discardCreatedTrack',
                payload: { trackId: targetTrackId, generatedMidiStateGuard },
            },
        };
        pendingDuplicateDescriptions.set(action, { guard: generatedMidiStateGuard, result });
        return result;
    },
    isNoop: (action) => {
        const tracks = getTrackStoreState()?.tracks;
        if (!tracks) {
            return false;
        }
        const targetTrackId = action.payload.targetTrackId;
        return targetTrackId !== undefined && tracks.some((track) => track.id === targetTrackId);
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
