/** One tool receipt a run read before it answered, in the words the user sees. */
export type AnswerEvidenceEntry = { callId: string; toolName: string; summary: string };

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
     * answer, so the user can see what the text rests on; an answer never carries a batch.
     */
    | { kind: 'answer'; text: string; evidence: readonly AnswerEvidenceEntry[] }
    | { kind: 'denied'; reason: string }
    | { kind: 'clarify'; reason: string; questions: string[] }
    /**
     * `searchedIntents` names what the run looked up before claiming the catalog cannot do this, so
     * a user reading the refusal can see whether it was looked for under the words they would use.
     */
    | { kind: 'unsupported'; reason: string; searchedIntents: string[] };
