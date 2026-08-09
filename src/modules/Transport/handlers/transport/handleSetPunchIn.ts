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

export const handleSetPunchIn = createHandler<'setPunchIn'>({
    execute: (alpha) => {
        setPunchIn(alpha.payload.beat);
    },
    describe: (alpha) => ({
        label: `Set punch in at beat ${alpha.payload.beat}`,
        inverseAction: createPunchRegionRestoreAction(),
    }),
    isNoop: (action) => isPunchInNoop(action.payload.beat),
    undoable: true,
});
