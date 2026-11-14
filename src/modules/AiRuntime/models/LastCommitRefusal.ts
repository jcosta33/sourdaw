/** A request relative to the last commit that the planner answers without a change: a question or a refusal. */
export type LastCommitRefusal =
    { status: 'clarify'; reason: string; questions: string[] } | { status: 'denied'; reason: string };

export function denied(reason: string): LastCommitRefusal {
    return { status: 'denied', reason };
}

export function clarify(reason: string, question: string): LastCommitRefusal {
    return { status: 'clarify', reason, questions: [question] };
}
