import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { disableTrack } from '../../useCases/toggleTrackState/disableTrack';

import { isDisableTrackSessionEntry } from './isDisableTrackSessionEntry';
import { describeMissingTrack, readPlannedDisplayTrack } from './readPlannedDisplayTrack';

type DisableTrackAction = Extract<AppAction, { type: 'disableTrack' }>;

function findRefusal(action: DisableTrackAction, context: HandlerValidationContext): string | null {
    const track = readPlannedDisplayTrack(action.payload.trackId, context);
    if (track === null) {
        return describeMissingTrack(action.payload.trackId);
    }
    // The master is the project's one output bus. Only a disable is refused: a master a saved project
    // holds disabled can still be enabled.
    if (track.kind === 'master' && action.payload.disabled) {
        return 'The master track cannot be disabled';
    }
    return null;
}

export const handleDisableTrack = createHandler<'disableTrack'>({
    validate: (action, context) => findRefusal(action, context) === null,
    validationRefusalReason: findRefusal,
    validateSessionEntry: isDisableTrackSessionEntry,
    execute: (action) => {
        disableTrack(action.payload.trackId, action.payload.disabled);
    },
    describe: (alpha, context) => {
        // Read the state this action finds, as earlier actions of its batch leave it, rather than
        // negating the request. `disableTrack` is an absolute set, not a toggle, so `!payload.disabled`
        // is only the prior value when the track actually changed — dispatching `disabled: true` at an
        // already-disabled track would otherwise record an inverse that enables it, undoing state this
        // action never touched. A batch describes every action before executing any, so the live store
        // would hand a second action on the same track a pre-batch value.
        const track = readPlannedDisplayTrack(alpha.payload.trackId, context);
        if (!track && context) {
            throw new Error(describeMissingTrack(alpha.payload.trackId));
        }
        const label = alpha.payload.disabled ? 'Disable track' : 'Enable track';
        if (!track) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'restoreTrackDisabled',
                payload: { trackId: track.id, expected: alpha.payload.disabled, replacement: track.disabled },
            },
            redoAction: {
                type: 'restoreTrackDisabled',
                payload: { trackId: track.id, expected: track.disabled, replacement: alpha.payload.disabled },
            },
        };
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.disabled ===
        action.payload.disabled,
    undoable: true,
});
