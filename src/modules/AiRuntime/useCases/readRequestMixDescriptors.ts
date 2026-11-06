import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type PerceptualConstraintReading } from '../models/PerceptualConstraint';
import { type ProjectContext } from '../models/ProjectContext';

import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { maskTrackReferences } from './maskTrackReferences';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MixRecipeDescriptor = MixRecipeCatalog['descriptors'][number];

/** Each constraint clause blanked in place, so a quality the request keeps is never one it asks for. */
function maskConstraintClauses(text: string, prompt: string, reading: PerceptualConstraintReading): string {
    const masked = text.split('');
    const clauses = [...reading.constraints, ...reading.unsupported].map((constraint) => constraint.clause);
    for (const clause of clauses) {
        for (let start = prompt.indexOf(clause); start !== -1; start = prompt.indexOf(clause, start + 1)) {
            masked.fill(' ', start, start + clause.length);
        }
    }
    return masked.join('');
}

/** Every descriptor term, longest first so a phrase ("more intimate") wins over a word inside it. */
function readTermPattern(catalog: MixRecipeCatalog): RegExp {
    const terms = catalog.descriptors
        .flatMap((descriptor) => catalog.descriptorTerms[descriptor])
        .toSorted((left, right) => right.length - left.length)
        .map((term) =>
            term
                .split(' ')
                .map(escapeRegExp)
                .join(String.raw`[\s-]+`)
        );
    return new RegExp(String.raw`\b(?:${terms.join('|')})(?![\p{L}\p{N}])`, 'giu');
}

function resolveTermDescriptor(catalog: MixRecipeCatalog, matched: string): MixRecipeDescriptor | null {
    const normalized = matched.toLowerCase().replaceAll(/[\s-]+/gu, ' ');
    return (
        catalog.descriptors.find((descriptor) =>
            catalog.descriptorTerms[descriptor].some((term) => term.replaceAll('-', ' ') === normalized)
        ) ?? null
    );
}

/**
 * The characters a whole-project request asks for, read from the request's own words in the recipe
 * catalog's descriptor vocabulary, first named first. Track names, quoted text and the request's
 * perceptual constraint clauses are blanked first: "Warm Pad" names a track, and "keep the vocal
 * intimate" keeps a quality rather than asking for one.
 */
export function readRequestMixDescriptors(input: {
    prompt: string;
    catalog: MixRecipeCatalog;
    context: ProjectContext;
    reading: PerceptualConstraintReading;
}): MixRecipeDescriptor[] {
    const unmasked = maskTrackReferences(input.prompt, input.context, ' ');
    const masked = maskConstraintClauses(unmasked, input.prompt, input.reading);
    const descriptors: MixRecipeDescriptor[] = [];
    for (const match of masked.matchAll(readTermPattern(input.catalog))) {
        const descriptor = resolveTermDescriptor(input.catalog, match[0]);
        if (descriptor !== null && !descriptors.includes(descriptor)) {
            descriptors.push(descriptor);
        }
    }
    return descriptors;
}
