import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerMaterializationContext } from '#/utils/handlerContract';

import { addTrack } from '../../useCases/addTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { planDefaultTrackName } from '../planDefaultTrackName';
import { isAddTrackSessionEntry } from '../validateCreationSessionEntries';

import { ensureStableCreationInputs } from './pinTrackCreationInputs';

type AddTrackAction = Extract<AppAction, { type: 'addTrack' }>;

/** The track's name: the caller's, or the kind's next default, pinned on the
 *  action so undo, redo and replay reproduce it rather than recompute it. */
function ensureTrackName(action: AddTrackAction, context?: HandlerMaterializationContext): string {
    if (action.payload.name === undefined) {
        action.payload.name = planDefaultTrackName(action.payload.kind, context);
    }
    return action.payload.name;
}

// Guards for tracks this handler creates, keyed by action so describe-time
// inverses can be finalized with the created entity once execute lands —
// the same pattern handleCreateBus uses to keep its discard inverse
// reapply-guarded inside atomic batches.
const pendingCreatedTrackGuards = new WeakMap<object, { entityJson: string; midiByClipIdJson: string }>();

function executeAddTrackAction(action: AddTrackAction, context?: HandlerMaterializationContext) {
    ensureStableCreationInputs(action);
    const name = ensureTrackName(action, context);
    const track = addTrack({ ...action.payload, name });
    if (!track) {
        return { status: 'no-write' as const };
    }
    const guard = pendingCreatedTrackGuards.get(action);
    if (guard) {
        guard.entityJson = JSON.stringify(track);
    }
    return { status: 'written' as const };
}

export const handleAddTrack = createHandler<'addTrack'>({
    validateSessionEntry: isAddTrackSessionEntry,
    materializeCommandArgumentsAt: 'execution',
    materializeCommandArguments: (action, context) => {
        ensureTrackName(action, context);
    },
    validate: (action, context) => {
        ensureTrackName(action, context);
        const trackId = ensureStableCreationInputs(action);
        const state = getTrackStoreState();
        return state !== null && !state.tracks.some((track) => track.id === trackId);
    },
    execute: executeAddTrackAction,
    describe: (action, context) => {
        const name = ensureTrackName(action, context);
        const trackId = ensureStableCreationInputs(action);
        const state = getTrackStoreState();
        const collides = state?.tracks.some((track) => track.id === trackId) ?? true;
        if (collides) {
            return {
                label: `Add ${action.payload.kind} track "${name}"`,
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
            label: `Add ${action.payload.kind} track "${name}"`,
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
