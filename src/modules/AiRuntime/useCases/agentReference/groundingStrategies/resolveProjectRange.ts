import { resolveMusicalRange } from '#/modules/Arrangement/useCases';
import { getBarStartBeat } from '#/modules/Transport/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';

/** A range a request or a call states, in any of the forms the musical range resolver reads. */
export type StatedRange = Parameters<typeof resolveMusicalRange>[0]['range'];

export type RangeResolution = ReturnType<typeof resolveMusicalRange>;

/** How the project the call writes to resolves `range`. */
export function resolveProjectRange(range: StatedRange, context: ProjectContext): RangeResolution {
    return resolveMusicalRange({
        range,
        sections: context.sections ?? [],
        markers: context.markers ?? [],
        tracks: context.tracks,
        barStartBeat: getBarStartBeat,
    });
}
