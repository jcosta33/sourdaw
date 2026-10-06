import { readBarStartBeat } from '#/modules/Transport/stores';

import {
    resolveMusicalRangeReference,
    type MusicalRangeReference,
    type MusicalRangeResolution,
} from '../models/MusicalRange';

import { markerStore } from './markerStore';
import { trackStore } from './trackStore';

type ReadMusicalRangeInput = {
    range: MusicalRangeReference;
};

/**
 * The beat interval a section reference, bar range, or beat range covers in the live project:
 * its sections and markers, its arrangement end, and bars placed through its meter map.
 *
 * A read for handlers in other modules, which cannot reach this module's use-case barrel without
 * closing an import cycle back through their own handler maps.
 */
export function readMusicalRange({ range }: ReadMusicalRangeInput): MusicalRangeResolution {
    return resolveMusicalRangeReference(range, {
        sections: markerStore.value?.sections ?? [],
        markers: markerStore.value?.markers ?? [],
        tracks: trackStore.value?.tracks ?? [],
        barStartBeat: (bar) => readBarStartBeat({ bar }),
    });
}
