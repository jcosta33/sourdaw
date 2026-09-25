import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { findGappedIntentPhrase, type IntentPhraseGaps } from './findGappedIntentPhrase';
import { getClauseIntentVocabulary, type CreationProposal } from './getClauseIntentVocabulary';
import { getStatedDecibelLevelForms } from './getStatedDecibelLevelForms';
import { normalizePromptText } from './normalizePromptText';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

function describesRatherThanCommands(suffix: string): boolean {
    return /^(?:is|means|seems|sounds|was|were)\b/u.test(suffix);
}

function startsWithPhrase(commandText: string, phrase: string): boolean {
    const normalizedPhrase = normalizePromptText(phrase);
    if (commandText === normalizedPhrase) {
        return true;
    }
    if (!commandText.startsWith(`${normalizedPhrase} `)) {
        return false;
    }
    return !describesRatherThanCommands(commandText.slice(normalizedPhrase.length).trim());
}

function startsWithGappedPhrase(commandSource: string, phrase: string, gaps: IntentPhraseGaps): boolean {
    const gapped = findGappedIntentPhrase(commandSource, phrase, gaps);
    if (gapped === null || gapped.index !== 0) {
        return false;
    }
    return !describesRatherThanCommands(normalizePromptText(commandSource.slice(gapped.end)));
}

export function isExplicitCommandClause(
    maskedText: string,
    catalog: GroundingCatalog,
    creationProposal?: CreationProposal
): boolean {
    let commandSource = maskedText.trim();
    commandSource = commandSource.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandSource = commandSource.replace(/^please\s+/iu, '');
    if (/^["'“”‘’]/u.test(commandSource)) {
        return false;
    }
    const commandText = normalizePromptText(commandSource);
    if (commandText.startsWith('make ')) {
        return true;
    }
    if (catalog.some((entry) => entry.intentPhrases.some((phrase) => startsWithPhrase(commandText, phrase)))) {
        return true;
    }
    const statedLevelForms = getStatedDecibelLevelForms(commandSource);
    return catalog.some((entry) => {
        const vocabulary = getClauseIntentVocabulary(entry, statedLevelForms, creationProposal);
        if (!vocabulary.statesDeclaredLevel && vocabulary.gaps.proposedNames.length === 0) {
            return false;
        }
        return vocabulary.phrases.some(
            (phrase) =>
                startsWithPhrase(commandText, phrase) || startsWithGappedPhrase(commandSource, phrase, vocabulary.gaps)
        );
    });
}
