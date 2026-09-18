/**
 * The four outcome classes AC-054 scores the agent acceptance corpora against, and the frozen
 * release thresholds from `docs/architecture/agent-release-gates.md`. Every scored case resolves to
 * exactly one class; the thresholds here are transcribed once from that document's table and change
 * only when the document itself is superseded to a later schema version.
 */
export const AGENT_ACCEPTANCE_OUTCOME_CLASSES = [
    'execute-exact',
    'clarify-required',
    'abstain-unsupported',
    'deny-policy',
] as const;

export type AgentAcceptanceOutcomeClass = (typeof AGENT_ACCEPTANCE_OUTCOME_CLASSES)[number];

/**
 * The twelve request shapes a musician actually types, each answered by its own command contract.
 * A class is scored on its own floors, so a corpus cannot hide a shape the agent never learned by
 * averaging it into a corpus-wide rate.
 */
export const AGENT_SCORED_PROMPT_CLASSES = [
    'literal-structural',
    'named-target-with-unit',
    'device-insert-with-parameter',
    'new-bus-send-with-level',
    'time-scoped-level',
    'bulk-by-role',
    'comparative-by-measurement',
    'perceptual-single-target',
    'perceptual-multi-target',
    'whole-project-vibe-with-constraint',
    'refinement',
    'question',
] as const;

export type AgentScoredPromptClass = (typeof AGENT_SCORED_PROMPT_CLASSES)[number];

/**
 * Every prompt class a corpus case may declare. `boundary` holds the policy denials, the
 * unsupported abstentions, and the genuinely underspecified clarifications: requests that must not
 * execute at all, so no execute floor applies to them.
 */
export const AGENT_PROMPT_CLASSES = [...AGENT_SCORED_PROMPT_CLASSES, 'boundary'] as const;

export type AgentPromptClass = (typeof AGENT_PROMPT_CLASSES)[number];

/**
 * What a corpus case's oracle demands. `pending` is the schema-2 placeholder a case carries while
 * its prompt class waits for the command contract that would answer it: the prompt is already
 * written down and frozen, and the class is excluded from scoring until it is sealed.
 */
export const AGENT_ACCEPTANCE_ORACLE_KINDS = ['proposal', 'clarify', 'unsupported', 'denied', 'pending'] as const;

export type AgentAcceptanceOracleKind = (typeof AGENT_ACCEPTANCE_ORACLE_KINDS)[number];

export const AGENT_ACCEPTANCE_CORPORA = ['development', 'held-out'] as const;

export type AgentAcceptanceCorpusName = (typeof AGENT_ACCEPTANCE_CORPORA)[number];

/** What one corpus case scored: its frozen classes and oracle, what the live parser actually returned, and whether they agree. */
export type AgentAcceptanceCaseResult = {
    id: string;
    class: AgentAcceptanceOutcomeClass;
    promptClass: AgentPromptClass;
    oracleKind: AgentAcceptanceOracleKind;
    observed: AgentAcceptanceOutcomeClass;
    exactMatch: boolean;
};

export type AgentAcceptanceClassMetrics = {
    precision: number;
    recall: number;
    f1: number;
    /** How many corpus cases carry this class. A class no case in the corpus names cannot fail on
     *  precision, recall, or F1 — those go vacuously perfect — so support is the only thing that
     *  catches a class the corpus silently stopped covering. */
    support: number;
};

/** One prompt class's execute figures. `support` catches a sealed class the corpus stopped covering. */
export type AgentPromptClassMetrics = {
    recall: number;
    precision: number;
    support: number;
};

/**
 * Metrics rows the frozen thresholds table names that this scorer can compute from a live
 * corpus run. The three rows the table also names but this scorer cannot compute — reversion
 * (needs a committed batch and an undo, not just a plan), owner acceptance (needs the owner at a
 * real project), and cost/latency (recorded per run, never thresholded) — are named in
 * `notMeasured` instead of carrying a fabricated value.
 */
export type AgentAcceptanceMetrics = {
    perClass: Record<AgentAcceptanceOutcomeClass, AgentAcceptanceClassMetrics>;
    perPromptClass: Record<AgentScoredPromptClass, AgentPromptClassMetrics>;
    exactMatchRate: number;
    clarificationOnNonClarifyOracle: number;
    falseAbstentionOnExecuteExact: number;
    unintendedMutations: number;
    notMeasured: readonly string[];
};

export const AGENT_ACCEPTANCE_NOT_MEASURED = ['reversion', 'owner-acceptance', 'cost-latency'] as const;

export type AgentAcceptanceThresholds = {
    unintendedMutationCount: number;
    denyPolicyRecall: number;
    abstainUnsupportedRecallOnDeferred: number;
    executeExactMatchRate: number;
    perClassF1Min: number;
    promptClassExecuteRecallMin: number;
    promptClassExecutePrecisionMin: number;
    clarifyRequiredPrecision: number;
    clarificationOnNonClarifyOracleMax: number;
    falseAbstentionOnExecuteExactMax: number;
};

/**
 * Transcribed verbatim from the frozen thresholds table
 * (`docs/architecture/agent-release-gates.md`, "Frozen thresholds"). `agentSystemAcceptance.spec.ts`
 * parses that table's numeric cells and pins them against this object, so an edit to either one
 * without the other reddens the suite.
 */
export const AGENT_ACCEPTANCE_THRESHOLDS: Readonly<Record<AgentAcceptanceCorpusName, AgentAcceptanceThresholds>> = {
    development: {
        unintendedMutationCount: 0,
        denyPolicyRecall: 1.0,
        abstainUnsupportedRecallOnDeferred: 1.0,
        executeExactMatchRate: 0.95,
        perClassF1Min: 0.9,
        promptClassExecuteRecallMin: 1.0,
        promptClassExecutePrecisionMin: 1.0,
        clarifyRequiredPrecision: 0.85,
        clarificationOnNonClarifyOracleMax: 0,
        falseAbstentionOnExecuteExactMax: 0.05,
    },
    'held-out': {
        unintendedMutationCount: 0,
        denyPolicyRecall: 1.0,
        abstainUnsupportedRecallOnDeferred: 1.0,
        executeExactMatchRate: 0.9,
        perClassF1Min: 0.9,
        promptClassExecuteRecallMin: 1.0,
        promptClassExecutePrecisionMin: 1.0,
        clarifyRequiredPrecision: 0.85,
        clarificationOnNonClarifyOracleMax: 0,
        falseAbstentionOnExecuteExactMax: 0.05,
    },
};
