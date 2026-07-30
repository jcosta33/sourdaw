import { createHandler } from '#/utils/createHandler';

import { setMetronomeVolume } from '../../useCases/transportControls/setMetronomeVolume';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetMetronomeVolume = createHandler<'setMetronomeVolume'>({
    execute: (action) => {
        setMetronomeVolume(action.payload.volume);
    },
    isNoop: (action) => getTransportState()?.metronomeVolume === Math.max(0, Math.min(1, action.payload.volume)),
    describe: (action) => {
        const previous = getTransportState()?.metronomeVolume;
        const volume = Math.max(0, Math.min(1, action.payload.volume));
        return {
            label: `Set metronome volume to ${Math.round(volume * 100)}%`,
            inverseAction:
                previous === undefined ? null : { type: 'setMetronomeVolume', payload: { volume: previous } },
        };
    },
    undoable: true,
});
