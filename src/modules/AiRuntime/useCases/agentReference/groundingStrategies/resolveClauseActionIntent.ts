import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { findGappedIntentPhrase, type IntentPhraseGaps } from './findGappedIntentPhrase';
import { getClauseIntentVocabulary, type CreationProposal } from './getClauseIntentVocabulary';
import { getIntentPhraseIndex } from './getIntentPhraseIndex';
import { getStatedDecibelLevelForms } from './getStatedDecibelLevelForms';
import { isExplicitCommandClause } from './isExplicitCommandClause';
import { isGenericDeviceIntent } from './isGenericDeviceIntent';
import { isNegatedIntent } from './isNegatedIntent';
import { normalizePromptText } from './normalizePromptText';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

type ClauseActionIntent = {
    actionType: string;
    index: number;
    phrase: string;
};

/** The earliest place the phrase names its action: contiguously, or across one gap the clause admits. */
function findPhraseIndex(maskedText: string, phrase: string, gaps: IntentPhraseGaps): number {
    const contiguousIndex = getIntentPhraseIndex(maskedText, phrase);
    const gapped = findGappedIntentPhrase(maskedText, phrase, gaps);
    if (gapped === null || (contiguousIndex >= 0 && contiguousIndex <= gapped.index)) {
        return contiguousIndex;
    }
    return gapped.index;
}

function getCreationProposal(
    expectedActionType: string | undefined,
    proposedNames: readonly string[]
): CreationProposal | undefined {
    if (expectedActionType === undefined || proposedNames.length === 0) {
        return undefined;
    }
    return { actionType: expectedActionType, proposedNames };
}

export function resolveClauseActionIntent(
    maskedText: string,
    catalog: GroundingCatalog,
    expectedActionType?: string,
    proposedNames: readonly string[] = []
): ClauseActionIntent | null {
    const creationProposal = getCreationProposal(expectedActionType, proposedNames);
    if (!isExplicitCommandClause(maskedText, catalog, creationProposal)) {
        return null;
    }
    const statedLevelForms = getStatedDecibelLevelForms(maskedText);
    const matches = catalog
        .flatMap((entry) => {
            const vocabulary = getClauseIntentVocabulary(entry, statedLevelForms, creationProposal);
            return vocabulary.phrases.map((phrase) => ({
                actionType: entry.actionType,
                index: findPhraseIndex(maskedText, phrase, vocabulary.gaps),
                phrase,
            }));
        })
        .filter((match) => match.index >= 0 && !isNegatedIntent(maskedText, match.phrase, match.index))
        .sort((left, right) => {
            const genericDifference =
                Number(isGenericDeviceIntent(left.phrase)) - Number(isGenericDeviceIntent(right.phrase));
            if (genericDifference !== 0) {
                return genericDifference;
            }
            if (left.index !== right.index) {
                return left.index - right.index;
            }
            return normalizePromptText(right.phrase).length - normalizePromptText(left.phrase).length;
        });
    const first = matches[0];
    if (!first) {
        return null;
    }
    const second = matches[1];
    if (
        second &&
        second.index === first.index &&
        normalizePromptText(second.phrase).length === normalizePromptText(first.phrase).length &&
        second.actionType !== first.actionType
    ) {
        const normalizedPhrase = normalizePromptText(first.phrase);
        if (expectedActionType && (normalizedPhrase === 'delete' || normalizedPhrase === 'remove')) {
            const expectedMatch = matches.find(
                (match) =>
                    match.index === first.index &&
                    normalizePromptText(match.phrase).length === normalizedPhrase.length &&
                    match.actionType === expectedActionType
            );
            if (expectedMatch) {
                return expectedMatch;
            }
        }
        return null;
    }
    return first;
}
