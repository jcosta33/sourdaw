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

/** A word that negates what follows it in its clause: "don't", "not", "without", "avoid", "never", "no more". */
const NEGATION_PATTERN =
    /(?<![\p{L}\p{N}])(?:\p{L}+n['’]t|cannot|not|never|without|avoid(?:s|ing)?|no(?:[\s-]+more)?|nor)(?![\p{L}\p{N}])/giu;

/** A word that keeps what follows it in its clause as it is: "keep the drums punchy", "leave it warm". */
const KEEP_PATTERN =
    /(?<![\p{L}\p{N}])(?:keep(?:s|ing)?|preserv(?:e|es|ing)|retain(?:s|ing)?|maintain(?:s|ing)?|leav(?:e|es|ing)|stay(?:s|ing)?)(?![\p{L}\p{N}])/giu;

/**
 * Where a negated or kept clause ends: a clause mark, a conjunction that turns to another clause, or
 * an `and` that opens a new instruction. A bare `and` joins another conjunct to the same clause, so
 * "keep the drums punchy and the vocal warm" keeps both.
 */
const CLAUSE_END_PATTERN =
    /[,.;:!?]|(?<![\p{L}\p{N}])(?:but|yet|then|though|although|however|instead|while|and[\s-]+(?:make|add|give|get|turn|bring|push|boost|raise|let|put|set))(?![\p{L}\p{N}])/giu;

/** A reduction word directly before a term, as in "less punchy", which no term of its own covers. */
const REDUCTION_BEFORE_PATTERN = /(?<![\p{L}\p{N}])less[\s-]+$/iu;

/** A complete "not only X but also Y" adds both clauses; its opening is not a prohibition. */
const ADDITIVE_NOT_ONLY_PATTERN = /^not[\s-]+only[\s-]+[^,.;:!?]+?\s+but[\s-]+also[\s-]+[^,.;:!?\s]+/iu;

/**
 * Each clause an opener heads blanked in place from the opener to the clause's end, offsets kept, so
 * "don't let the vocal get brighter" or "keep the drums punchy and the vocal warm" names a quality
 * the request withholds or keeps rather than one it asks for.
 */
function maskOpenedClauses(text: string, opener: RegExp): string {
    const masked = text.split('');
    for (const match of text.matchAll(opener)) {
        if (opener === NEGATION_PATTERN && ADDITIVE_NOT_ONLY_PATTERN.test(text.slice(match.index))) {
            continue;
        }
        const clauseEnd = new RegExp(CLAUSE_END_PATTERN.source, CLAUSE_END_PATTERN.flags);
        clauseEnd.lastIndex = match.index + match[0].length;
        const end = clauseEnd.exec(text)?.index ?? text.length;
        masked.fill(' ', match.index, end);
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
 * intimate" keeps a quality rather than asking for one. So is every clause a negation or a keep
 * heads, through each conjunct it joins, and a term "less" reduces where the catalog has no term for
 * that phrase ("less punchy"; "less muddy" is the catalog's own): a quality the request withholds,
 * reduces or keeps is left out, never planned as an increase nor read as another character.
 */
export function readRequestMixDescriptors(input: {
    prompt: string;
    catalog: MixRecipeCatalog;
    context: ProjectContext;
    reading: PerceptualConstraintReading;
}): MixRecipeDescriptor[] {
    const unmasked = maskTrackReferences(input.prompt, input.context, ' ');
    // The opened clauses are read before the constraint clauses are blanked, which would take a
    // keep's own verb with them and leave its later conjuncts ("and the vocal warm") unopened.
    const opened = maskOpenedClauses(maskOpenedClauses(unmasked, NEGATION_PATTERN), KEEP_PATTERN);
    const masked = maskConstraintClauses(opened, input.prompt, input.reading);
    const descriptors: MixRecipeDescriptor[] = [];
    for (const match of masked.matchAll(readTermPattern(input.catalog))) {
        if (REDUCTION_BEFORE_PATTERN.test(masked.slice(0, match.index))) {
            continue;
        }
        const descriptor = resolveTermDescriptor(input.catalog, match[0]);
        if (descriptor !== null && !descriptors.includes(descriptor)) {
            descriptors.push(descriptor);
        }
    }
    return descriptors;
}
