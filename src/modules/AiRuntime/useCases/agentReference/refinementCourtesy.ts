import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { refinementFigure, type RefinementClause } from './bindRefinementFigure';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { refinementActionWords } from './refinementActionWords';
import { refinementRequestReading, type ReferenceCandidate } from './refinementRequestReading';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

/**
 * Words that ask for a change in no figure and no action phrase of the catalog: a comparison ("slower",
 * "wider"), an edit of the change itself ("double", "undo", "toggle") or a state ("unmuted", "audible").
 * A clause stating one is never courtesy.
 */
const CHANGE_WORDS: ReadonlySet<string> = new Set([
    'double',
    'halve',
    'triple',
    'undo',
    'redo',
    'revert',
    'reset',
    'restore',
    'toggle',
    'flip',
    'swap',
    'muted',
    'unmuted',
    'soloed',
    'unsoloed',
    'armed',
    'disarmed',
    'bypassed',
    'audible',
    'silent',
    'slower',
    'faster',
    'wider',
    'narrower',
    'gentler',
    'stronger',
    'weaker',
    'harder',
    'brighter',
    'darker',
    'warmer',
    'bigger',
    'smaller',
    'longer',
    'shorter',
    'tighter',
    'looser',
    'drier',
    'wetter',
]);

/**
 * Every word that may state an action: each word of the phrases the action catalog names an action by,
 * of the verbs a value clause sets or moves its value by, and of the removal verbs.
 */
function collectActionWords(catalog: GroundingCatalog): ReadonlySet<string> {
    const phrases = [
        ...catalog.flatMap((entry) => entry.intentPhrases.concat(entry.levelIntentPhrases ?? [])),
        ...refinementActionWords.valueVerbs,
        ...refinementActionWords.movingVerbs,
        ...refinementRequestReading.removalVerbs,
    ];
    return new Set(phrases.flatMap((phrase) => normalizePromptText(phrase).split(' ')));
}

/**
 * Whether a clause states courtesy alone ("Hi", "Sorry", "That should be better", "if possible"): it
 * names no project object and states no figure, no direction, side or unit word, no comparative, no
 * negation, no word of an action phrase or verb, and no word asking for a change. Only beside a batch
 * the refinement text grounds by itself is such a clause read as asking for nothing; wherever a call
 * inherits a pending command, only the closed filler list is.
 */
function readCourtesy(
    catalog: GroundingCatalog,
    candidates: readonly ReferenceCandidate[]
): (clause: RefinementClause) => boolean {
    const actionWords = collectActionWords(catalog);
    const asks = (word: string) =>
        actionWords.has(word) || CHANGE_WORDS.has(word) || refinementFigure.comparativeWords.has(word);
    return (clause) =>
        refinementRequestReading.references(clause.text, candidates).length === 0 &&
        !refinementFigure.statesValue(clause) &&
        !refinementRequestReading.statesNegation(clause) &&
        resolveClauseActionIntent(clause.masked, catalog) === null &&
        !normalizePromptText(clause.masked).split(' ').some(asks);
}

/** How a refinement clause reads as courtesy alone, beside a batch its text grounds by itself. */
export const refinementCourtesy = {
    reader: readCourtesy,
} as const;
