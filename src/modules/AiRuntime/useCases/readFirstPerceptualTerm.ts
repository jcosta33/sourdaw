import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../models/ProjectContext';

import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { normalizeAgentReferenceText } from './agentReference/normalizeAgentReferenceText';
import { maskTrackReferences } from './maskTrackReferences';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;

/**
 * The catalog's own descriptor terms the prompt states, longest phrase first so "less bright" is
 * read once, as `dark`'s term, and not again as `bright`.
 */
export function readFirstPerceptualTerm(
    prompt: string,
    context: ProjectContext,
    catalog: MixRecipeCatalog
): { term: string; start: number; end: number } | null {
    const masked = maskTrackReferences(prompt, context, ' ');
    const terms = catalog.descriptors
        .flatMap((descriptor) => catalog.descriptorTerms[descriptor])
        .toSorted((left, right) => right.length - left.length);
    let first: { term: string; start: number; end: number } | null = null;
    for (const term of terms) {
        const words = normalizeAgentReferenceText(term).split(' ').map(escapeRegExp).join('[\\s-]+');
        const match = new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'iu').exec(masked);
        if (match !== null && (first === null || match.index < first.start)) {
            first = { term, start: match.index, end: match.index + match[0].length };
        }
    }
    return first;
}
