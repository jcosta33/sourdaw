import {
    resolveMusicalRangeReference,
    type MusicalRangeReference,
    type MusicalRangeResolution,
    type MusicalRangeSources,
} from '../../../models/MusicalRange';

type ResolveMusicalRangeInput = MusicalRangeSources & {
    range: MusicalRangeReference;
};

/**
 * The beat interval a section reference, bar range, or beat range covers, read against the
 * sections, markers, tracks and meter the caller supplies — a planner reasons over its own project
 * snapshot, so the sources are explicit rather than read from the live stores. `readMusicalRange`
 * in this module's stores answers the same question against the live project.
 */
export function resolveMusicalRange({
    range,
    sections,
    markers,
    tracks,
    barStartBeat,
}: ResolveMusicalRangeInput): MusicalRangeResolution {
    return resolveMusicalRangeReference(range, { sections, markers, tracks, barStartBeat });
}
