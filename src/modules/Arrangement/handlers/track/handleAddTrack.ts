import { createHandler } from '#/utils/createHandler';

import { addTrack } from '../../useCases/addTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { publishTrackAdded } from '../../useCases/publishTrackAdded';

type AddTrackAction = {
    payload: {
        color?: string;
        gain?: number;
        id?: string;
        initialAlternativeId?: string;
        initialDeviceId?: string;
        name: string;
        kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
        parentId?: string;
        outputId?: string;
        select?: boolean;
        withoutDefaultDevice?: boolean;
    };
};

function ensureTrackId(action: AddTrackAction): string {
    if (action.payload.id) {
        return action.payload.id;
    }
    const trackId = `track-ai-${crypto.randomUUID()}`;
    action.payload.id = trackId;
    return trackId;
}

// Guards for tracks this handler creates, keyed by action so describe-time
// inverses can be finalized with the created entity once execute lands —
// the same pattern handleCreateBus uses to keep its discard inverse
// reapply-guarded inside atomic batches.
const pendingCreatedTrackGuards = new WeakMap<object, { entityJson: string; midiByClipIdJson: string }>();

function executeAddTrackAction(action: AddTrackAction) {
    ensureTrackId(action);
    const track = addTrack({ ...action.payload, suppressAddedEvent: true });
    if (!track) {
        return { status: 'no-write' as const };
    }
    const guard = pendingCreatedTrackGuards.get(action);
    if (guard) {
        guard.entityJson = JSON.stringify(track);
    }
    return {
        status: 'written' as const,
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
}

export const handleAddTrack = createHandler<'addTrack'>({
    validate: (action) => {
        const trackId = ensureTrackId(action);
        const state = getTrackStoreState();
        return state !== null && !state.tracks.some((track) => track.id === trackId);
    },
    execute: executeAddTrackAction,
    describe: (action) => {
        const trackId = ensureTrackId(action);
        const state = getTrackStoreState();
        const collides = state?.tracks.some((track) => track.id === trackId) ?? true;
        if (collides) {
            return {
                label: `Add ${action.payload.kind} track "${action.payload.name}"`,
                inverseAction: null,
            };
        }
        // Without the guard, discardCreatedTrack's canReapplyAfterDivergence
        // returns false and any atomic batch containing this action is
        // rejected ("Action compensation is not guarded inside an atomic
        // batch: addTrack") — the prompt fast path's "create N tracks" could
        // never be confirmed.
        const generatedMidiStateGuard = {
            entityJson: '',
            midiByClipIdJson: JSON.stringify({}),
        };
        pendingCreatedTrackGuards.set(action, generatedMidiStateGuard);
        return {
            label: `Add ${action.payload.kind} track "${action.payload.name}"`,
            inverseAction: {
                type: 'discardCreatedTrack',
                payload: { trackId, generatedMidiStateGuard },
            },
        };
    },
    isNoop: (action) => {
        const state = getTrackStoreState();
        if (!state) {
            return true;
        }
        const trackId = action.payload.id;
        return trackId !== undefined && state.tracks.some((track) => track.id === trackId);
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
