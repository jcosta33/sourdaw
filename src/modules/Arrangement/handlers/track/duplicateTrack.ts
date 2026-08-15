import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { duplicateTrack } from '../../useCases/duplicateTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { publishTrackAdded } from '../../useCases/publishTrackAdded';

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

// Guards for duplicates this handler creates, keyed by action so the
// describe-time inverse is finalized with the created entity once execute
// lands — the handleAddTrack/handleCreateBus pattern.
const pendingDuplicateGuards = new WeakMap<object, { entityJson: string; midiByClipIdJson: string }>();

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
            suppressAddedEvent: boolean;
            targetTrackId: string;
        } = {
            suppressAddedEvent: true,
            targetTrackId: ensureTargetTrackId(action),
        };
        if (action.payload.select !== undefined) {
            options.select = action.payload.select;
        }
        const track = duplicateTrack(action.payload.trackId, options);
        if (!track) {
            return { status: 'conflict' };
        }
        const guard = pendingDuplicateGuards.get(action);
        if (guard) {
            // Finalize from the committed store track: the use case's return
            // value predates its own step that copies devices, sends, and
            // clips, and isGeneratedMidiStateCurrent compares the guard
            // against the store shape. Satellite state copied from the source
            // (envelopes, warp, clip automation) makes the comparison fail —
            // undo then refuses with a conflict instead of corrupting.
            const committed = getTrackStoreState()?.tracks.find((candidate) => candidate.id === track.id);
            if (committed) {
                guard.entityJson = JSON.stringify(committed);
                guard.midiByClipIdJson = serializeMidiStateForClips(collectTrackClipIds(committed));
            }
        }
        return {
            status: 'written',
            afterCommit: () =>
                publishTrackAdded({
                    trackId: track.id,
                    name: track.name,
                    kind: track.kind,
                }),
            afterAmbiguousCommit: async () => {
                const committedTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === track.id);
                if (!committedTrack) {
                    return;
                }
                await publishTrackAdded({
                    trackId: committedTrack.id,
                    name: committedTrack.name,
                    kind: committedTrack.kind,
                });
            },
        };
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
        pendingDuplicateGuards.set(action, generatedMidiStateGuard);
        return {
            label: 'Duplicate track',
            inverseAction: {
                type: 'discardCreatedTrack',
                payload: { trackId: targetTrackId, generatedMidiStateGuard },
            },
        };
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
