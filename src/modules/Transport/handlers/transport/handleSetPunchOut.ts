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

export const handleSetPunchOut = createHandler<'setPunchOut'>({
    execute: (alpha) => {
        setPunchOut(alpha.payload.beat);
    },
    describe: (alpha) => ({
        label: `Set punch out at beat ${alpha.payload.beat}`,
        inverseAction: createPunchRegionRestoreAction(),
    }),
    isNoop: (action) => isPunchOutNoop(action.payload.beat),
    undoable: true,
});
