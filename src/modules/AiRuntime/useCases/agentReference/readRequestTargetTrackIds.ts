import { type ProjectContext } from '../../models/ProjectContext';
import { findIntroducedObjectRanges } from '../../transformers/promptParser/hasHighLevelCreationEvidence';

import { CREATED_OBJECT_NOUN } from './batchLocalBindingProducers';
import { type Range } from './readProtectionSlots';

/** A reference a comparison measures against ("brighter than the Snare"), which the request does not edit. */
const COMPARISON_REFERENCE_LEAD = /\bthan\s+(?:the\s+|my\s+|our\s+|your\s+)?$/iu;

/**
 * Whether a reference names something other than an object the request edits: a comparison's
 * reference, or a word inside an object the request creates ("add a Kick Parallel track"), read with
 * the plan-created object route's creation-evidence rules.
 */
function namesNoEditTarget(reference: Range, unquoted: string, createdObjects: readonly Range[]): boolean {
    return (
        COMPARISON_REFERENCE_LEAD.test(unquoted.slice(0, reference.start)) ||
        createdObjects.some((created) => reference.start >= created.start && reference.end <= created.end)
    );
}

/** The tracks the request names as its own edit targets, outside every protection slot: what "it" can point at. */
export function readRequestTargetTrackIds(
    references: ReadonlyArray<Range & { denotes: ReadonlySet<string> }>,
    slots: readonly Range[],
    context: ProjectContext,
    unquoted: string
): Set<string> {
    const trackIds = new Set(context.tracks.map((track) => track.id));
    // Read over the request with quotations masked and project names intact, which the creation reader needs.
    const createdObjects = findIntroducedObjectRanges(unquoted, CREATED_OBJECT_NOUN);
    const targets = new Set<string>();
    for (const reference of references) {
        if (slots.some((slot) => reference.start >= slot.start && reference.end <= slot.end)) {
            continue;
        }
        if (namesNoEditTarget(reference, unquoted, createdObjects)) {
            continue;
        }
        for (const id of reference.denotes) {
            if (trackIds.has(id)) {
                targets.add(id);
            }
        }
    }
    return targets;
}
