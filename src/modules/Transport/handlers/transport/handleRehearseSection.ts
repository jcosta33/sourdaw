import { readMusicalRange } from '#/modules/Arrangement/stores';
import { getMarkerState } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

import { seekPlayhead } from '../../useCases/transportControls/seekPlayhead';
import { setLoopEnabled } from '../../useCases/transportControls/setLoopEnabled';
import { setLoopRegion } from '../../useCases/transportControls/setLoopRegion';
import { setPlayback } from '../../useCases/transportControls/setPlayback';

export const handleRehearseSection = createHandler<'rehearseSection'>({
    execute: (action) => {
        const section = getMarkerState()?.sections.find((candidate) => candidate.id === action.payload.sectionId);
        if (!section) {
            return;
        }
        const range = readMusicalRange({ range: { startBeat: section.startBeat, endBeat: section.endBeat } });
        if (range.kind !== 'resolved' || !setLoopRegion(range.startBeat, range.endBeat, action.payload.loop)) {
            return;
        }
        if (!action.payload.loop && !setLoopEnabled(false)) {
            return;
        }
        const completion = seekPlayhead(range.startBeat).then((committed) => {
            if (committed) {
                setPlayback(true);
            }
        });
        return { status: 'written', afterRuntimeExecution: () => completion };
    },
    describe: (action) => {
        const name = getMarkerState()?.sections.find((section) => section.id === action.payload.sectionId)?.name;
        const verb = action.payload.loop ? 'Loop' : 'Play';
        return { label: name ? `${verb} section "${name}"` : `${verb} section` };
    },
    executionKind: 'runtime',
    undoable: false,
});
