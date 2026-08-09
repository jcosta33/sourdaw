import { createHandler } from '#/utils/createHandler';

import { createPunchRegionPatch } from '../../useCases/transportControls/punchRegion';
import { setPunchOut } from '../../useCases/transportControls/setPunchOut';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { createPunchRegionRestoreAction } from './createPunchRegionRestoreAction';

function isPunchOutNoop(beat: number): boolean {
    const current = getTransportState();
    if (!current) {
        return true;
    }

    const patch = createPunchRegionPatch({ current, beat, edge: 'out' });
    if (patch === null) {
        return true;
    }

    return (
        (patch.punchInBeat ?? current.punchInBeat) === current.punchInBeat &&
        (patch.punchOutBeat ?? current.punchOutBeat) === current.punchOutBeat
    );
}

function describePunchOutChange(beat: number) {
    const label = `Set punch out at beat ${beat}`;
    const current = getTransportState();
    if (!current) {
        return { label, inverseAction: null };
    }

    const patch = createPunchRegionPatch({ current, beat, edge: 'out' });
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

export const handleSetPunchOut = createHandler<'setPunchOut'>({
    execute: (alpha) => ({ status: setPunchOut(alpha.payload.beat) ? 'written' : 'no-write' }),
    describe: (alpha) => describePunchOutChange(alpha.payload.beat),
    isNoop: (action) => isPunchOutNoop(action.payload.beat),
    undoable: true,
});
