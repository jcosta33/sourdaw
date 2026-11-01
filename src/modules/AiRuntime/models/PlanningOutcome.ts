/** One tool receipt a run read before it answered, in the words the user sees. */
export type AnswerEvidenceEntry = { callId: string; toolName: string; summary: string };

/**
 * The one catalog recipe an answer described for one track, which the user may ask to have prepared
 * as a proposal. The application builds it from the admitted `recipe.discover` receipt and the
 * frozen project read, never from provider text; `roleSource` says whether discovery read the role
 * from the target or from an explicit argument, so the proposal resolves the role the same way.
 */
export type AnswerSuggestion = {
    recipeId: string;
    recipeTitle: string;
    targetId: string;
    targetName: string;
    recipeRole: string;
    roleSource: 'argument' | 'target';
};

/**
 * Why one planning attempt produced no executable batch, or that it produced one. Every planning
 * result carries a kind, so a caller never has to infer "nothing matched" from an empty action list
 * that a refusal, a question, and an unsupported capability all share.
 */
export type PlanningOutcome =
    | { kind: 'proposal' }
    | { kind: 'no-match' }
    /**
     * The request asked for information, not a change. `evidence` lists the receipts the run read to
     * answer, so the user can see what the text rests on; an answer never carries a batch. A
     * `suggestion` is an offer the text states, compiled into a proposal only when the user asks.
     */
    | { kind: 'answer'; text: string; evidence: readonly AnswerEvidenceEntry[]; suggestion?: AnswerSuggestion }
    | { kind: 'denied'; reason: string }
    | { kind: 'clarify'; reason: string; questions: string[] }
    /**
     * The request undoes the chat thread's last commit. It carries no batch: the caller undoes that
     * commit's revert group as one group, through the AI history's revert, never by new commands.
     */
    | { kind: 'revert'; runId: string; revertGroupId: string }
    /**
     * `searchedIntents` names what the run looked up before claiming the catalog cannot do this, so
     * a user reading the refusal can see whether it was looked for under the words they would use.
     */
    | { kind: 'unsupported'; reason: string; searchedIntents: string[] };
