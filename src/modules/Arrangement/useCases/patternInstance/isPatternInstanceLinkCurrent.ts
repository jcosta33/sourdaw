import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { getPatternInstanceLinkState } from './getPatternInstanceLinkState';

type Input = Extract<AppAction, { type: 'restorePatternInstanceLink' }>['payload'];

export function isPatternInstanceLinkCurrent(input: Input): boolean {
    const captured = getPatternInstanceLinkState(input.clipId);
    return captured !== null && captured.trackId === input.trackId && valuesEqual(captured.state, input.expected);
}
