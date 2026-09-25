import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type IntentPhraseGaps } from './findGappedIntentPhrase';

type GroundingCatalogEntry = ReturnType<typeof getExecutableAppActionGroundingCatalog>[number];

/** The names one creation action's calls propose for the objects they create. */
export type CreationProposal = {
    actionType: string;
    proposedNames: readonly string[];
};

export type ClauseIntentVocabulary = {
    gaps: IntentPhraseGaps;
    phrases: readonly string[];
    /** Whether the clause states a decibel figure in a form this action declares. */
    statesDeclaredLevel: boolean;
};

/**
 * The phrases that may name one action in a clause, and the gaps they may match across. The
 * action's intent phrases always count, contiguously. A clause stating a decibel figure in a form the
 * action declares adds its level phrases and admits one masked project reference inside a phrase;
 * a creation the caller proposes names for admits one of those names inside a phrase.
 */
export function getClauseIntentVocabulary(
    entry: GroundingCatalogEntry,
    statedLevelForms: ReadonlySet<string>,
    creationProposal: CreationProposal | undefined
): ClauseIntentVocabulary {
    const statesDeclaredLevel = (entry.decibelLevelForms ?? []).some((form) => statedLevelForms.has(form));
    const proposedNames = creationProposal?.actionType === entry.actionType ? creationProposal.proposedNames : [];
    const gaps = { maskedReference: statesDeclaredLevel, proposedNames };
    if (!statesDeclaredLevel || entry.levelIntentPhrases === undefined) {
        return { gaps, phrases: entry.intentPhrases, statesDeclaredLevel };
    }
    return { gaps, phrases: [...entry.intentPhrases, ...entry.levelIntentPhrases], statesDeclaredLevel };
}
