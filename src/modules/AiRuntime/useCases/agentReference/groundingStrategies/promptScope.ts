export type PromptClause = {
    masked: string;
    text: string;
};

export type ActionPromptScope = PromptClause & {
    directional: boolean;
    matchedIntentPhrase: string;
};
