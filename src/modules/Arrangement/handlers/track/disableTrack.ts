import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { disableTrack } from '../../useCases/toggleTrackState/disableTrack';

export const handleDisableTrack = createHandler<'disableTrack'>({
    execute: (action) => {
        disableTrack(action.payload.trackId, action.payload.disabled);
    },
    describe: (alpha) => {
        // Read the pre-state rather than negating the request. `disableTrack` is an
        // absolute set, not a toggle, so `!payload.disabled` is only the prior value
        // when the track actually changed — dispatching `disabled: true` at an
        // already-disabled track would otherwise record an inverse that enables it,
        // undoing state this action never touched.
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === alpha.payload.trackId);
        return {
            label: alpha.payload.disabled ? 'Disable track' : 'Enable track',
            inverseAction: track
                ? {
                      type: 'restoreTrackDisabled',
                      payload: {
                          trackId: track.id,
                          expected: alpha.payload.disabled,
                          replacement: track.disabled,
                      },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'restoreTrackDisabled',
                      payload: {
                          trackId: track.id,
                          expected: track.disabled,
                          replacement: alpha.payload.disabled,
                      },
                  }
                : alpha,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.disabled ===
        action.payload.disabled,
    undoable: true,
});
