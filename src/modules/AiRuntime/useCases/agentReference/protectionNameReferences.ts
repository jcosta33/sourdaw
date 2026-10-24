import { type ProjectContext } from '../../models/ProjectContext';

import { CONTROL_WORDS, KIND_NOUNS, NON_OBJECT_WORDS, protectionVocabulary } from './protectionVocabulary';
import { type ReferenceCandidate } from './refinementRequestReading';

type Range = { start: number; end: number };
type NamedRange = Range & { denotes: ReadonlySet<string> };

/** The extra names a project holds that the refinement reader's candidates leave out. */
function getExtraCandidates(context: ProjectContext): ReferenceCandidate[] {
    const groups: Array<ReadonlyArray<{ id: string; name: string }> | undefined> = [
        context.markers,
        context.sections,
        context.automationLanes,
        context.adjustmentLayers,
    ];
    const named = groups.flatMap((objects) => objects ?? []);
    return named.map((object) => ({
        name: object.name
            .toLocaleLowerCase()
            .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
            .trim(),
        denotes: new Set([object.id]),
    }));
}

function blankRanges(text: string, ranges: readonly Range[]): string {
    return ranges.reduce(
        (blanked, { start, end }) => `${blanked.slice(0, start)}${'□'.repeat(end - start)}${blanked.slice(end)}`,
        text
    );
}

function normalizeName(text: string): string {
    return text
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** Each name also in the other grammatical number ("the Vocal" for Vocals), which a request states a name in. */
function readNumberVariants(candidates: readonly ReferenceCandidate[]): ReferenceCandidate[] {
    const known = new Set(candidates.map((candidate) => candidate.name));
    return candidates.flatMap((candidate) => {
        const { name } = candidate;
        const other = name.endsWith('s') ? name.slice(0, -1) : `${name}s`;
        const isWord =
            protectionVocabulary.hasWord(NON_OBJECT_WORDS, other) ||
            protectionVocabulary.hasWord(CONTROL_WORDS, other) ||
            protectionVocabulary.hasWord(KIND_NOUNS, other);
        if (known.has(other) || other.length < 4 || name.endsWith('ss') || isWord) {
            return [];
        }
        return [{ name: other, denotes: candidate.denotes }];
    });
}

/** A variant of a name followed by `group` or `bus` is another object's name ("the drum group"), not the track's. */
function isVariantOfAnotherKind(
    prompt: string,
    reference: { start: number; end: number },
    exactNames: ReadonlySet<string>
): boolean {
    const isVariant = !exactNames.has(normalizeName(prompt.slice(reference.start, reference.end)));
    return isVariant && /^\s+(?:groups?|bus(?:es)?)\b/iu.test(prompt.slice(reference.end));
}

/** The member tracks of every VCA group the slot names. */
function readVcaMemberTracks(
    references: readonly NamedRange[],
    slot: Range,
    vcaGroups: ReadonlyMap<string, readonly string[]>
): string[] {
    return references
        .filter((reference) => reference.start >= slot.start && reference.end <= slot.end)
        .flatMap((reference) => Array.from(reference.denotes).flatMap((id) => vcaGroups.get(id) ?? []));
}

/** The tracks the request names outside every protection slot: what "it" can point at. */
function readTargetTrackIds(
    references: readonly NamedRange[],
    slots: readonly Range[],
    context: ProjectContext
): Set<string> {
    const trackIds = new Set(context.tracks.map((track) => track.id));
    const targets = new Set<string>();
    for (const reference of references) {
        if (slots.some((slot) => reference.start >= slot.start && reference.end <= slot.end)) {
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

export const protectionNameReferences = {
    getExtraCandidates,
    blankRanges,
    normalizeName,
    readNumberVariants,
    isVariantOfAnotherKind,
    readVcaMemberTracks,
    readTargetTrackIds,
} as const;
