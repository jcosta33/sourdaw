import { readMusicalRange } from '#/modules/Arrangement/stores';
import { getMarkerState } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { seekPlayhead } from '../../useCases/transportControls/seekPlayhead';

type ArrangementSection = NonNullable<ReturnType<typeof getMarkerState>>['sections'][number];

function compareSections(first: ArrangementSection, second: ArrangementSection): number {
    return first.startBeat - second.startBeat || first.endBeat - second.endBeat || first.id.localeCompare(second.id);
}

export const handleNavigateSection = createHandler<'navigateSection'>({
    execute: (action) => {
        const playhead = playheadPositionRef.current;
        const sections = (getMarkerState()?.sections ?? [])
            .filter((section) => section.endBeat > section.startBeat)
            .sort(compareSections);
        let target: ArrangementSection | undefined;
        if (action.payload.direction === 'next') {
            target = sections.find((section) => section.startBeat > playhead);
        } else {
            target = sections.findLast((section) => section.startBeat < playhead);
        }
        if (!target) {
            return;
        }
        const range = readMusicalRange({ range: { startBeat: target.startBeat, endBeat: target.endBeat } });
        if (range.kind === 'resolved') {
            seekPlayhead(range.startBeat);
        }
    },
    describe: (action) => ({ label: action.payload.direction === 'next' ? 'Next section' : 'Previous section' }),
    executionKind: 'runtime',
    undoable: false,
});
