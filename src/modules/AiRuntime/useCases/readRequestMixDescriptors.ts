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

const INSTRUCTION_VERBS = String.raw`(?:make|add|give|get|turn|bring|push|boost|raise|let|put|set)`;

/**
 * Where a negated or kept clause ends: a clause mark, a conjunction that turns to another clause, or
 * an `and` that opens a new instruction. A bare `and` joins another conjunct to the same clause, so
 * "keep the drums punchy and the vocal warm" keeps both.
 */
const CLAUSE_END_PATTERN = new RegExp(
    String.raw`[,.;:!?]|(?<![\p{L}\p{N}])(?:but|yet|then|though|although|however|instead|while|and[\s-]+${INSTRUCTION_VERBS})(?![\p{L}\p{N}])`,
    'giu'
);

/** A reduction word directly before a term, as in "less punchy", which no term of its own covers. */
const REDUCTION_BEFORE_PATTERN = /(?<![\p{L}\p{N}])less[\s-]+$/iu;

type AdditiveCorrelative = { start: number; connectorStart: number; end: number };

function nextClauseEnd(text: string, start: number): RegExpExecArray | null {
    const clauseEnd = new RegExp(CLAUSE_END_PATTERN.source, CLAUSE_END_PATTERN.flags);
    clauseEnd.lastIndex = start;
    return clauseEnd.exec(text);
}

/**
 * Complete "not only/just/merely/simply X[,] but [also] Y" correlatives add both qualities.
 * Read their structure in the original text at the masked text's clause boundaries, retaining
 * names as operands without accepting their contents as grammar. A sentence or new instruction ends the phrase.
 */
function readAdditiveCorrelatives(text: string, prompt: string): AdditiveCorrelative[] {
    const pairs: AdditiveCorrelative[] = [];
    const openingPattern = /(?<![\p{L}\p{N}])not[\s-]+(?:only|just|merely|simply)(?=[\s-])/giu;
    const instructionPattern = new RegExp(String.raw`^${INSTRUCTION_VERBS}(?![\p{L}\p{N}])`, 'iu');
    for (const opening of text.matchAll(openingPattern)) {
        const operandStart = opening.index + opening[0].length;
        const boundary = nextClauseEnd(text, operandStart);
        if (boundary === null || prompt.slice(operandStart, boundary.index).trim() === '') {
            continue;
        }
        const connector = /^(?:,\s*)?but[\s-]+/iu.exec(prompt.slice(boundary.index));
        if (connector === null || text.slice(boundary.index, boundary.index + connector[0].length) !== connector[0]) {
            continue;
        }
        let secondStart = boundary.index + connector[0].length;
        const also = /^also[\s-]+/iu.exec(prompt.slice(secondStart));
        if (also !== null && text.slice(secondStart, secondStart + also[0].length) === also[0]) {
            secondStart += also[0].length;
        }
        const end = nextClauseEnd(text, secondStart)?.index ?? prompt.length;
        const second = text.slice(secondStart, end).trim();
        if (
            prompt.slice(secondStart, end).trim() === '' ||
            /^also$/iu.test(second) ||
            instructionPattern.test(second)
        ) {
            continue;
        }
        pairs.push({ start: opening.index, connectorStart: boundary.index, end });
    }
    return pairs;
}

/**
 * Blank each negated or kept clause in place. An outer prohibition or keep owns a whole
 * correlative pair; a prohibition inside either operand still owns only that operand's clause.
 */
function maskOpenedClauses(text: string, opener: RegExp, pairs: AdditiveCorrelative[]): string {
    const masked = text.split('');
    for (const match of text.matchAll(opener)) {
        if (opener === NEGATION_PATTERN && pairs.some((pair) => pair.start === match.index)) {
            continue;
        }
        let end = nextClauseEnd(text, match.index + match[0].length)?.index ?? text.length;
        for (const pair of pairs) {
            if (match.index < pair.start && pair.start < end && end === pair.connectorStart) {
                end = pair.end;
            }
        }
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
    const pairs = readAdditiveCorrelatives(unmasked, input.prompt);
    const opened = maskOpenedClauses(maskOpenedClauses(unmasked, NEGATION_PATTERN, pairs), KEEP_PATTERN, pairs);
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
