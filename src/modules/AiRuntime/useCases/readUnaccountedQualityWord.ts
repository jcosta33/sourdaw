import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../models/ProjectContext';
import { scanPromptQuotedText } from '../transformers/promptParser/promptQuotedText';

import { readFirstPerceptualTerm } from './admitPerceptualGoalDecline';
import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { maskTrackReferences } from './maskTrackReferences';
import { compilePerceptualConstraints } from './perceptualConstraints/compilePerceptualConstraints';
import { readComparedQualityWords } from './readComparedQualities';

// A slash joins clauses only with space around it, so a registered phrase such as "punch in/out" stays whole.
const CLAUSE_SEPARATOR = /[.;,!?\n&:()—–]|\s\/\s|\b(?:and|then|but|so|while|with|or|plus)\b/u;
const DECIBEL_UNIT = String.raw`(?:db|lufs|lkfs|dbfs|dbtp)`;
// A frequency states no amount of any quality, so it never accounts for the word beside it.
const UNIT = String.raw`(?:${DECIBEL_UNIT}|%|ms|s)`;
const FIGURE = String.raw`-?\d+(?:\.\d+)?`;
const NOT_FREQUENCY = String.raw`(?!\s*k?hz\b)`;
// "volume" and "level" name a fader control, so outside a comparison they state no quality.
const CONTROL_NOUN = /\b(?:volume|level)\b/giu;
const COMPARISON = /\bthan\b/iu;
const DETERMINER = String.raw`(?:(?:the|a|an|this|that|my)\s+)?`;
/** A figure qualifies a quality only in its own phrase: "3 dB louder", "louder by 3 dB", "gain-level to -6". */
const FIGURE_QUALIFIERS = [
    new RegExp(String.raw`${FIGURE}\s*${UNIT}\b\s+\p{L}+`, 'giu'),
    new RegExp(String.raw`\p{L}+\s+by\s+${FIGURE}${NOT_FREQUENCY}(?:\s*${UNIT}\b)?(?![\d.]*\w)`, 'giu'),
    new RegExp(String.raw`\S+\s+(?:to|at)\s+${FIGURE}${NOT_FREQUENCY}(?:\s*${UNIT}\b)?(?![\d.]*\w)`, 'giu'),
];
const COMMAND_CARRIER = String.raw`^\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:(?:don['’]?t|do\s+not|never)\s+)?`;

function blank(text: string, start: number, end: number): string {
    return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

/**
 * A figure accounts only for the word it directly qualifies ("3 dB louder", "louder by 3 dB"). A comparison
 * ("louder than Bass") states a quality against a target, which no figure accounts for.
 */
function blankFigureQualifiers(clause: string): string {
    if (COMPARISON.test(clause)) {
        return clause;
    }
    const qualified = FIGURE_QUALIFIERS.reduce(
        (text, pattern) => text.replaceAll(pattern, (span) => ' '.repeat(span.length)),
        clause
    );
    return qualified.replaceAll(CONTROL_NOUN, (span) => ' '.repeat(span.length));
}

/** A clause the perceptual-constraint reader consumed becomes a constraint goal, so it states no literal claim. */
function blankConstraintClauses(masked: string, prompt: string, context: ProjectContext): string {
    const reading = compilePerceptualConstraints(prompt, context);
    return [...reading.constraints, ...reading.unsupported].reduce((text, { clause }) => {
        const start = prompt.indexOf(clause);
        return start < 0 ? text : blank(text, start, start + clause.length);
    }, masked);
}

/**
 * A registered command phrase that opens a clause ("set punch in", "glue the clips") names the command, not a
 * quality: "punch" and "glue" are descriptor words only where no command phrase is opening the clause.
 */
function blankCommandPhrase(clause: string, phrases: readonly string[]): string {
    for (const phrase of phrases) {
        const body = phrase
            .split(/\s+/u)
            .map(escapeRegExp)
            .join(String.raw`\s+${DETERMINER}`);
        // A phrase followed by "than" opens a comparison ("quieter than Kick"), which is a quality, not a command.
        const match = new RegExp(`${COMMAND_CARRIER}(${body})(?![\\p{L}\\p{N}])(?!\\s+than\\b)`, 'iu').exec(clause);
        const span = match?.[1];
        if (match !== null && span !== undefined) {
            const start = match.index + match[0].length - span.length;
            return blank(clause, start, start + span.length);
        }
    }
    return clause;
}

/**
 * The first quality word a request states that no figure of its own accounts for, or null when it states
 * none. A track name or quotation never counts, a clause the constraint reader consumed is a constraint
 * goal elsewhere, a registered command phrase opening a clause names a command, and "3 dB louder" is a
 * stated amount, not a perceptual claim. A figure accounts only for the word it qualifies, never a
 * neighbouring clause's quality.
 */
export function readUnaccountedQualityWord(prompt: string, context: ProjectContext): string | null {
    const catalog = getMixRecipeCatalog();
    const phrases = getExecutableAppActionGroundingCatalog()
        .flatMap((entry) => entry.intentPhrases)
        .toSorted((left, right) => right.length - left.length);
    // An unclosed apostrophe leaves the quoting unknown, so then every word is the request's own.
    const named = scanPromptQuotedText(prompt).complete ? maskTrackReferences(prompt, context, ' ') : prompt;
    const masked = blankConstraintClauses(named, prompt, context);
    for (const clause of masked.split(CLAUSE_SEPARATOR)) {
        const stated = blankCommandPhrase(blankFigureQualifiers(clause), phrases);
        const term = readFirstPerceptualTerm(stated, context, catalog);
        if (term !== null) {
            return term.term;
        }
        const [word] = readComparedQualityWords(stated, context).values();
        if (word !== undefined) {
            return word;
        }
    }
    return null;
}
