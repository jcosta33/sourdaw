import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type LoopRegion = {
    loopStart: number;
    loopEnd: number;
    isLooping: boolean;
};

type RestoreLoopRegionInput = {
    expected: LoopRegion;
    replacement: LoopRegion;
};

function isValidLoopRegion(region: LoopRegion): boolean {
    return (
        Number.isFinite(region.loopStart) &&
        Number.isFinite(region.loopEnd) &&
        region.loopStart >= 0 &&
        region.loopEnd >= region.loopStart &&
        (!region.isLooping || region.loopEnd > region.loopStart)
    );
}

function matchesLoopRegion(state: LoopRegion, region: LoopRegion): boolean {
    return (
        state.loopStart === region.loopStart && state.loopEnd === region.loopEnd && state.isLooping === region.isLooping
    );
}

export function restoreLoopRegion({ expected, replacement }: RestoreLoopRegionInput): HandlerExecutionResult {
    const state = getTransportState();
    if (!state || !isValidLoopRegion(expected) || !isValidLoopRegion(replacement)) {
        return { status: 'no-write' };
    }
    if (matchesLoopRegion(state, replacement)) {
        return { status: 'no-write' };
    }
    if (!matchesLoopRegion(state, expected)) {
        return { status: 'conflict' };
    }

    updateTransportState(replacement);
    return { status: 'written' };
}
