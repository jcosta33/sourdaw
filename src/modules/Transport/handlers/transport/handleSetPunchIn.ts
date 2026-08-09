import { createHandler } from '#/utils/createHandler';

import { createPunchRegionPatch } from '../../useCases/transportControls/punchRegion';
import { setPunchIn } from '../../useCases/transportControls/setPunchIn';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { createPunchRegionRestoreAction } from './createPunchRegionRestoreAction';

function isPunchInNoop(beat: number): boolean {
    const current = getTransportState();
    if (!current) {
        return true;
    }

    const patch = createPunchRegionPatch({ current, beat, edge: 'in' });
    if (patch === null) {
        return true;
    }

    return (
        (patch.punchInBeat ?? current.punchInBeat) === current.punchInBeat &&
        (patch.punchOutBeat ?? current.punchOutBeat) === current.punchOutBeat
    );
}

function describePunchInChange(beat: number) {
    const label = `Set punch in at beat ${beat}`;
    const current = getTransportState();
    if (!current) {
        return { label, inverseAction: null };
    }

    const patch = createPunchRegionPatch({ current, beat, edge: 'in' });
    if (patch === null) {
        return { label, inverseAction: null };
    }

    const before = {
        punchInBeat: current.punchInBeat,
        punchOutBeat: current.punchOutBeat,
    };
    const after = {
        punchInBeat: patch.punchInBeat ?? current.punchInBeat,
        punchOutBeat: patch.punchOutBeat ?? current.punchOutBeat,
    };
    return {
        label,
        inverseAction: createPunchRegionRestoreAction({ expected: after, replacement: before }),
        redoAction: createPunchRegionRestoreAction({ expected: before, replacement: after }),
    };
}

export const handleSetPunchIn = createHandler<'setPunchIn'>({
    execute: (alpha) => ({ status: setPunchIn(alpha.payload.beat) ? 'written' : 'no-write' }),
    describe: (alpha) => describePunchInChange(alpha.payload.beat),
    isNoop: (action) => isPunchInNoop(action.payload.beat),
    undoable: true,
});
