import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../models/ProjectContext';
import { scanPromptQuotedText } from '../transformers/promptParser/promptQuotedText';

import { readFirstPerceptualTerm } from './admitPerceptualGoalDecline';
import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { maskTrackReferences } from './maskTrackReferences';
import { compilePerceptualConstraints } from './perceptualConstraints/compilePerceptualConstraints';
import { readComparedQualities } from './readComparedQualities';

const CLAUSE_SEPARATOR = /[.;,!?\n]|\b(?:and|then|but)\b/u;
const STATED_FIGURE =
    /-?\d+(?:\.\d+)?\s*(?:db|hz|khz|%|lufs|lkfs|dbfs|dbtp|ms|s)\b|\b(?:to|at|by)\s+-?\d+(?:\.\d+)?(?![\d.]*\w)/iu;
const COMMAND_CARRIER = String.raw`^\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:(?:don['’]?t|do\s+not|never)\s+)?`;

function blank(text: string, start: number, end: number): string {
    return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
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
            .join(String.raw`\s+`);
        const match = new RegExp(`${COMMAND_CARRIER}(${body})(?![\\p{L}\\p{N}])`, 'iu').exec(clause);
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
 * stated amount, not a perceptual claim, so a clause holding a figure is read as literal.
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
        if (STATED_FIGURE.test(clause)) {
            continue;
        }
        const stated = blankCommandPhrase(clause, phrases);
        const term = readFirstPerceptualTerm(stated, context, catalog);
        if (term !== null) {
            return term.term;
        }
        const [quality] = readComparedQualities(stated, context);
        if (quality !== undefined) {
            return quality;
        }
    }
    return null;
}
