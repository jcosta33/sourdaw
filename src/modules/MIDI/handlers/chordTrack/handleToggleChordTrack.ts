import { createHandler } from '#/utils/createHandler';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { toggleChordTrack } from '../../useCases/chordTrack/toggleChordTrack';

import { describeChordTrackMutation } from './handleRestoreChordTrackState';

type ToggleAction = { payload?: { enabled?: boolean } };

function getTarget(action: ToggleAction): boolean {
    const target = action.payload?.enabled ?? !(chordTrackStore.value?.enabled ?? false);
    action.payload = { enabled: target };
    return target;
}

export const handleToggleChordTrack = createHandler<'toggleChordTrack'>({
    execute: (action) => {
        toggleChordTrack(getTarget(action));
    },
    describe: (action) => {
        const label = getTarget(action) ? 'Enable chord track' : 'Disable chord track';
        return describeChordTrackMutation(action, label);
    },
    isNoop: (action) => {
        const state = chordTrackStore.value;
        if (!state) {
            return true;
        }
        return getTarget(action) === state.enabled;
    },
    undoable: true,
});
