export type PromptClause = {
    masked: string;
    text: string;
};

/** The texts a source and a destination reference are read from. */
export type PromptRoleTexts = {
    destination: string;
    source: string;
};

export type ActionPromptScope = PromptClause & {
    directional: boolean;
    matchedIntentPhrase: string;
    /**
     * Set when the roles are not the halves of `text` around its first `to`: a scope that took in a
     * continuation clause, or one attached to the clause naming its destination.
     */
    roleTexts?: PromptRoleTexts;
    /** How many same-action calls this scope grounds; one when absent. */
    referenceSlots?: number;
};
