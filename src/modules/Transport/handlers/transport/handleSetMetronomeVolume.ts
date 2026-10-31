import { METRONOME_LEVEL_LAW, resolveLevelFields } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { setMetronomeVolume } from '../../useCases/transportControls/setMetronomeVolume';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

type Action = Extract<AppAction, { type: 'setMetronomeVolume' }>;

function requestedVolume(action: Action, current: number) {
    return resolveLevelFields(
        { linear: action.payload.volume, absoluteDb: action.payload.volumeDb, deltaDb: action.payload.deltaDb },
        current,
        METRONOME_LEVEL_LAW
    );
}

export const handleSetMetronomeVolume = createHandler<'setMetronomeVolume'>({
    batchExecution: 'singleton',
    validate: (action) => {
        const current = getTransportState()?.metronomeVolume;
        return current === undefined || requestedVolume(action, current).ok;
    },
    execute: (action) => {
        const current = getTransportState()?.metronomeVolume;
        if (current === undefined) {
            return { status: 'no-write' };
        }
        const requested = requestedVolume(action, current);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        setMetronomeVolume(requested.linear);
        return undefined;
    },
    isNoop: (action) => {
        const current = getTransportState()?.metronomeVolume;
        if (current === undefined) {
            return false;
        }
        const requested = requestedVolume(action, current);
        return requested.ok && current === Math.max(0, Math.min(1, requested.linear));
    },
    describe: (action) => {
        const previous = getTransportState()?.metronomeVolume;
        if (previous === undefined) {
            return { label: 'Set metronome volume', inverseAction: null };
        }
        const requested = requestedVolume(action, previous);
        if (!requested.ok) {
            return { label: 'Set metronome volume', inverseAction: null };
        }
        const volume = Math.max(0, Math.min(1, requested.linear));
        return {
            label: `Set metronome volume to ${Math.round(volume * 100)}%`,
            inverseAction: { type: 'setMetronomeVolume', payload: { volume: previous } },
            redoAction: { type: 'setMetronomeVolume', payload: { volume } },
        };
    },
    undoable: true,
});
