import { readBarStartBeat } from '#/modules/Transport/stores';

import { getMusicalRangeInputs, type MusicalRangeInput, type MusicalRangeReference } from '../models/MusicalRange';

import { markerStore } from './markerStore';
import { trackStore } from './trackStore';

type ReadMusicalRangeInputsInput = {
    range: MusicalRangeReference;
};

/**
 * What a stated range is read against in the live project, so a handler can refuse to resolve it
 * after an earlier member of its batch that edits one of those inputs.
 */
export function readMusicalRangeInputs({ range }: ReadMusicalRangeInputsInput): readonly MusicalRangeInput[] {
    return getMusicalRangeInputs(range, {
        sections: markerStore.value?.sections ?? [],
        markers: markerStore.value?.markers ?? [],
        tracks: trackStore.value?.tracks ?? [],
        barStartBeat: (bar) => readBarStartBeat({ bar }),
    });
}
