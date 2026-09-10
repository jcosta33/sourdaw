import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { getIntentPhraseIndex } from './getIntentPhraseIndex';
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

export function resolveClauseActionIntent(
    maskedText: string,
    catalog: GroundingCatalog,
    expectedActionType?: string
): ClauseActionIntent | null {
    if (!isExplicitCommandClause(maskedText, catalog)) {
        return null;
    }
    const matches = catalog
        .flatMap((entry) =>
            entry.intentPhrases.map((phrase) => ({
                actionType: entry.actionType,
                index: getIntentPhraseIndex(maskedText, phrase),
                phrase,
            }))
        )
        .filter((match) => match.index >= 0 && !isNegatedIntent(maskedText, match.phrase))
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
