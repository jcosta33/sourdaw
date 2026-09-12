import { createHandler } from '#/utils/createHandler';

import { setLoopRegion } from '../../useCases/transportControls/setLoopRegion';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

function normalizeLoopRegion(startBeat: number, endBeat: number) {
    return {
        loopStart: Math.max(0, Math.min(startBeat, endBeat)),
        loopEnd: Math.max(startBeat, endBeat),
    };
}

function restoreLoopRegionAction(
    expected: { loopStart: number; loopEnd: number; isLooping: boolean },
    replacement: {
        loopStart: number;
        loopEnd: number;
        isLooping: boolean;
    }
) {
    return { type: 'restoreLoopRegion' as const, payload: { expected, replacement } };
}

export const handleSetLoopRegion = createHandler<'setLoopRegion'>({
    execute: (action) => ({
        status: setLoopRegion(action.payload.startBeat, action.payload.endBeat, false) ? 'written' : 'no-write',
    }),
    isNoop: (action) => {
        const state = getTransportState();
        const { loopStart, loopEnd } = normalizeLoopRegion(action.payload.startBeat, action.payload.endBeat);
        return state?.loopStart === loopStart && state.loopEnd === loopEnd;
    },
    describe: (action) => {
        const previous = getTransportState();
        const { loopStart, loopEnd } = normalizeLoopRegion(action.payload.startBeat, action.payload.endBeat);
        const next = previous ? { loopStart, loopEnd, isLooping: previous.isLooping } : null;
        return {
            label: `Set loop region from beat ${loopStart} to ${loopEnd}`,
            inverseAction: previous
                ? restoreLoopRegionAction(next!, {
                      loopStart: previous.loopStart,
                      loopEnd: previous.loopEnd,
                      isLooping: previous.isLooping,
                  })
                : null,
            redoAction:
                previous && next
                    ? restoreLoopRegionAction(
                          { loopStart: previous.loopStart, loopEnd: previous.loopEnd, isLooping: previous.isLooping },
                          next
                      )
                    : action,
        };
    },
    undoable: true,
});
