import { createHandler } from '#/utils/createHandler';

import { setLoopRegion } from '../../useCases/transportControls/setLoopRegion';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetLoopRegion = createHandler<'setLoopRegion'>({
    execute: (action) => {
        setLoopRegion(action.payload.startBeat, action.payload.endBeat, false);
    },
    isNoop: (action) => {
        const state = getTransportState();
        const loopStart = Math.max(0, Math.min(action.payload.startBeat, action.payload.endBeat));
        const loopEnd = Math.max(action.payload.startBeat, action.payload.endBeat);
        return state?.loopStart === loopStart && state.loopEnd === loopEnd;
    },
    describe: (action) => {
        const previous = getTransportState();
        const loopStart = Math.max(0, Math.min(action.payload.startBeat, action.payload.endBeat));
        const loopEnd = Math.max(action.payload.startBeat, action.payload.endBeat);
        return {
            label: `Set loop region from beat ${loopStart} to ${loopEnd}`,
            inverseAction: previous
                ? {
                      type: 'restoreLoopRegion',
                      payload: {
                          loopStart: previous.loopStart,
                          loopEnd: previous.loopEnd,
                          isLooping: previous.isLooping,
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
