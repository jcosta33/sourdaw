import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../models/ProjectContext';

import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { normalizeAgentReferenceText } from './agentReference/normalizeAgentReferenceText';
import { maskTrackReferences } from './maskTrackReferences';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MixRecipeDescriptor = MixRecipeCatalog['descriptors'][number];

/**
 * Every descriptor whose catalog term the request states outside track names and quotations. Terms are
 * read longest first and each match is blanked, so "less bright" names `dark` alone and never `bright`.
 */
export function readStatedRecipeDescriptors(
    prompt: string,
    context: ProjectContext,
    catalog: MixRecipeCatalog
): ReadonlySet<MixRecipeDescriptor> {
    const terms = catalog.descriptors
        .flatMap((descriptor) => catalog.descriptorTerms[descriptor].map((term) => ({ descriptor, term })))
        .toSorted((left, right) => right.term.length - left.term.length);
    const stated = new Set<MixRecipeDescriptor>();
    let masked = maskTrackReferences(prompt, context, ' ');
    for (const { descriptor, term } of terms) {
        const words = normalizeAgentReferenceText(term).split(' ').map(escapeRegExp).join('[\\s-]+');
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'giu');
        masked = masked.replaceAll(pattern, (span) => {
            stated.add(descriptor);
            return ' '.repeat(span.length);
        });
    }
    return stated;
}
