import { seekPlayhead, setLoopRegion, setPlayback } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

import { readMusicalRange } from '../../stores/readMusicalRange';
import { getMarkerState } from '../../useCases/timelineQueries';

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
        seekPlayhead(range.startBeat);
        setPlayback(true);
    },
    describe: (action) => {
        const name = getMarkerState()?.sections.find((section) => section.id === action.payload.sectionId)?.name;
        const verb = action.payload.loop ? 'Loop' : 'Play';
        return { label: name ? `${verb} section "${name}"` : `${verb} section` };
    },
    executionKind: 'runtime',
    undoable: false,
});
