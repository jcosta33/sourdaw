/**
 * The measurement record's shape, and the small vocabulary helpers every part of it shares.
 *
 * A record outlives the run that produced it, so its fields are declared here once rather than beside
 * the code that fills them: the reader, the per-artifact derivation, and the across-run aggregation
 * all read this file to know what a figure is. Nothing here performs I/O, and nothing here decides
 * what a figure means — the derivations live in `artifacts.ts` and `record.ts`.
 */

import { type SemanticScopeStates } from '../semanticReview/scopeAccounting.ts';

import type { ReviewDossier } from '../reviewDossier.ts';
import type { SemanticUsageReport } from '../semanticReview/report.ts';

export type { SemanticScopeStates };

export const SEMANTIC_MEASUREMENT_FORMAT = 'semantic-review-measurement-v1';
export const SEMANTIC_MEASUREMENT_SCHEMA_VERSION = 1;

/** A stored artifact this record was built from, identified by its own bytes. */
export type MeasurementArtifact = {
    readonly kind: 'scan' | 'verification' | 'evaluation-fixture';
    readonly path: string;
    readonly sha256: string;
};

/**
 * Why one applicable rule was not asked. `missing-required-evidence` is a rule-level gap — other rules
 * of the same request were answered, and this one's evidence was withheld — while
 * `no-answerable-question` is the unit-level gap of a request no pass could carry any evidence for.
 * The last three name the omission state the run recorded, so a spent budget never reads as a model
 * that had nothing to say.
 */
export const RULE_NOT_ASKED_REASONS = [
    'missing-required-evidence',
    'no-answerable-question',
    'omitted-for-budget-or-deadline',
    'provider-failure',
    'dry-run',
] as const;
export type RuleNotAskedReason = (typeof RULE_NOT_ASKED_REASONS)[number];

export type RuleCoverage = {
    readonly applicableRules: number;
    /**
     * Whether `applicableRules` is the exact count. A stored report written before `scope.requestOrder`
     * existed publishes the rule set only of the units that produced a signal, so the rules of a unit
     * omitted before admission are in no artifact and the count is a floor.
     */
    readonly applicableRulesComplete: boolean;
    /** Units whose planned rule set no stored field publishes; their rules are in no figure here. */
    readonly unitsWithUnpublishedRuleSets: number;
    readonly askedRules: number;
    readonly notAskedRules: number;
    readonly notAskedByReason: Readonly<Record<RuleNotAskedReason, number>>;
};

export type EvidenceCompleteness = {
    /** Units with at least one rule whose required evidence was not supplied. */
    readonly unitsMissingRequiredEvidence: number;
    readonly requiredEvidenceTokensMissing: Readonly<Record<string, number>>;
    /** Null when the artifact carries no truncation ledger at all, which is not the same as none. */
    readonly truncatedRegions: number | null;
    readonly truncatedPaths: number | null;
    readonly truncationReasons: Readonly<Record<string, number>> | null;
    readonly limitationCount: number;
};

/**
 * The run's own omission totals. `publishedStates` is the block the report wrote; `derivedFromEntries`
 * is recomputed from the report's own `excluded` and `unassessed` entries by the same function the
 * report validator holds the published block to, so a stored report cannot publish a cause its entries
 * do not record without this record showing the disagreement.
 */
export type OutcomeAccounting = {
    readonly publishedStates: SemanticScopeStates | null;
    readonly derivedFromEntries: SemanticScopeStates;
    readonly unassessedReasons: Readonly<Record<string, number>>;
    readonly excludedReasons: Readonly<Record<string, number>>;
};

export type RunUsage = SemanticUsageReport & {
    /** A unit answered from the response cache made no network attempt of its own. */
    readonly cacheHits: number;
};

export type RunWallClock = {
    readonly startedAt: string;
    readonly completedAt: string;
    /** The run's own span; no part of it is estimated from request counts or bytes. */
    readonly durationMs: number;
};

export type FiredSignal = {
    readonly ruleId: string;
    readonly path: string;
};

/** One typed outcome a review round recorded, with the dossier it was recorded in. */
export type RecordedSignalDisposition = {
    readonly ruleId: string;
    readonly path: string;
    readonly disposition: string;
    readonly artifact: string | null;
    readonly dossier: string;
};

export type SignalOutcome = {
    readonly totalSignals: number;
    readonly byDisposition: Readonly<Record<string, number>>;
    /** The signals that asked the orchestrator to investigate, which are the ones a round must dispose of. */
    readonly firedSignals: readonly FiredSignal[];
    readonly dossiersMatched: readonly string[];
    readonly dispositionsRecorded: readonly RecordedSignalDisposition[];
    readonly dismissedFiredSignals: number;
    /**
     * Fired signals on a head whose stored dossier disposes of none of them. A head with no dossier at
     * all is counted in `firedSignalsWithoutDossier` instead: nothing recorded whether it was disposed.
     */
    readonly undismissedFiredSignals: readonly FiredSignal[];
    readonly firedSignalsWithoutDossier: number;
};

export type FindingOutcome = {
    readonly totalAssessments: number;
    readonly byDisposition: Readonly<Record<string, number>>;
    readonly escalated: number;
};

/** What one stored dossier records: the round's draws and the outcomes it reached. */
export type ReviewRoundSummary = {
    readonly path: string;
    readonly pr: number;
    readonly headSha: string;
    readonly stanceDraws: number;
    readonly stanceOutcomes: Readonly<Record<string, number>>;
    readonly findingsAccepted: number;
    readonly findingsDiscarded: number;
    readonly findingsPublished: number;
    readonly reviewsPublished: number;
    readonly reassessments: number;
    readonly recommendation: string;
    readonly assessmentImpact: string | null;
    /** Whether the dossier carries the typed disposition list at all, which an older record does not. */
    readonly dispositionsRecorded: boolean;
};

export type MeasurementRun = {
    readonly artifact: MeasurementArtifact;
    readonly runId: string;
    readonly mode: 'scan' | 'verify';
    readonly execution: string;
    readonly failureCode: string | null;
    readonly context: {
        readonly repository: string | null;
        readonly prNumber: number | null;
        readonly headSha: string | null;
        readonly mergeBaseSha: string | null;
        readonly evidenceProfile: string | null;
    };
    readonly models: {
        readonly requested: string;
        readonly returned: readonly string[];
    };
    /** Null for an artifact that records no start and end, which is not a span of zero. */
    readonly wallClock: RunWallClock | null;
    readonly usage: RunUsage;
    /** Null for a mode that assesses findings rather than rule applicability. */
    readonly ruleCoverage: RuleCoverage | null;
    readonly evidenceCompleteness: EvidenceCompleteness;
    readonly outcomeAccounting: OutcomeAccounting;
    readonly signalOutcome: SignalOutcome | null;
    readonly findingOutcome: FindingOutcome | null;
    readonly reviewRounds: readonly ReviewRoundSummary[];
    /** The labelled-expectation count an evaluation fixture carries; never an accuracy figure. */
    readonly labelledExpectationHeld: boolean | null;
};

/**
 * One corpus fixture as the evaluation runner records it. It is a count of labels that held, over the
 * rules under test: evidence about the rules and the provider, never a measure of how often the review
 * is right about a change, and never a figure this record calls accuracy.
 */
export type EvaluationFixtureOutcome = {
    readonly fixtureId: string;
    readonly kind: string;
    readonly path: string;
    readonly ruleId: string;
    readonly sourceKind: string;
    readonly execution: string;
    readonly failureCode?: string;
    readonly requestedModel: string;
    readonly returnedModels: readonly string[];
    readonly rulesAsked: readonly string[];
    readonly rulesNotAsked: readonly { readonly ruleId: string; readonly missingEvidence: readonly string[] }[];
    readonly evidenceSupplied: readonly string[];
    readonly missingEvidenceByRule: Readonly<Record<string, readonly string[]>>;
    readonly outcomes: readonly {
        readonly ruleId: string;
        readonly outcome: string;
        readonly probability: number;
        readonly disposition: string;
        readonly reasoning: string;
    }[];
    readonly expectedConcernHeld: boolean;
    readonly otherSignals: readonly string[];
    readonly providerRequests: number;
    readonly usage: SemanticUsageReport;
    readonly limitations: readonly string[];
};

export type StoredDossier = { readonly path: string; readonly dossier: ReviewDossier };

export type SkippedArtifact = { readonly path: string; readonly reason: string };

export type MeasurementSources = {
    readonly sidecarRoot: string;
    readonly sidecarRootPresent: boolean;
    readonly reviewBundleRoot: string;
    readonly reviewBundleRootPresent: boolean;
    readonly evaluationOutcomePath: string | null;
    readonly storedRunsRead: number;
    readonly dossiersRead: number;
    readonly evaluationFixturesRead: number;
    readonly note: string;
};

export type MeasurementMachine = {
    readonly checkoutGitSha: string;
    readonly workingTree: string;
    readonly host: {
        readonly platform: string;
        readonly release: string;
        readonly arch: string;
        readonly cores: number;
    };
    readonly loadAverage1m: number;
};

export type NotComputableFigure = { readonly figure: string; readonly reason: string };

/**
 * The vocabularies a reader accumulates across artifacts while it has each report in hand.
 *
 * They are kept out of the per-run entries purely for size: a per-run list of every rule and every
 * limitation text repeats the same small vocabulary once per run, so the record publishes each of these
 * once for the whole set instead. `buildMeasurementRecord` merges them into `acrossRuns`.
 */
export type RecordExtras = {
    readonly notAskedByRule: Readonly<Record<string, number>>;
    readonly signalsByRule: Readonly<Record<string, number>>;
    readonly limitationsByText: Readonly<Record<string, number>>;
};

export type RepeatedWarning = {
    readonly repository: string;
    readonly prNumber: number;
    readonly ruleId: string;
    readonly path: string;
    /** Distinct heads of that one pull request on which the pair was flagged, in sha order. */
    readonly heads: readonly string[];
};

export type AcrossRuns = {
    readonly runCount: number;
    readonly runCountByKind: Readonly<Record<string, number>>;
    readonly usage: RunUsage;
    /** The sum of the runs' own spans, over the runs that recorded one. */
    readonly wallClockMs: number;
    readonly wallClockRuns: number;
    readonly derivedOutcomeStates: SemanticScopeStates;
    readonly publishedOutcomeStates: SemanticScopeStates;
    readonly publishedOutcomeRuns: number;
    readonly ruleCoverage: {
        readonly applicableRules: number;
        readonly applicableRulesCompleteEverywhere: boolean;
        readonly unitsWithUnpublishedRuleSets: number;
        readonly askedRules: number;
        readonly notAskedRules: number;
        readonly notAskedByReason: Readonly<Record<RuleNotAskedReason, number>>;
        /** Which rules no request asked, and how many times each was left unasked. */
        readonly notAskedByRule: Readonly<Record<string, number>>;
        readonly runsWithoutRuleCoverage: number;
    };
    readonly evidence: {
        readonly unitsMissingRequiredEvidence: number;
        readonly requiredEvidenceTokensMissing: Readonly<Record<string, number>>;
        readonly truncatedRegions: number;
        readonly truncatedPaths: number;
        readonly truncationReasons: Readonly<Record<string, number>>;
        /** Each distinct limitation text a run recorded, with the number of runs that recorded it. */
        readonly limitationsByText: Readonly<Record<string, number>>;
        readonly runsWithoutTruncationLedger: number;
    };
    readonly signals: {
        readonly total: number;
        readonly byDisposition: Readonly<Record<string, number>>;
        /** Every rule's signals across the runs, and how many each rule returned. */
        readonly byRule: Readonly<Record<string, number>>;
        readonly fired: number;
        readonly byFindingDisposition: Readonly<Record<string, number>>;
    };
    readonly signalDispositions: {
        readonly recorded: number;
        readonly byToken: Readonly<Record<string, number>>;
        readonly dismissedFiredSignals: number;
        readonly undismissedFiredSignals: number;
        readonly withoutDossier: number;
    };
    readonly reviewRounds: {
        readonly dossiers: number;
        readonly stanceDraws: number;
        readonly findingsAccepted: number;
        readonly findingsDiscarded: number;
        readonly reviewsPublished: number;
    };
    readonly labelledExpectations: { readonly held: number; readonly total: number } | null;
    readonly repeatedWarnings: readonly RepeatedWarning[];
};

export type MeasurementRecord = {
    readonly format: string;
    readonly schemaVersion: number;
    readonly measuredAt: string;
    readonly machine: MeasurementMachine;
    readonly advisory: string;
    readonly fieldSources: Readonly<Record<string, string>>;
    readonly sources: MeasurementSources;
    readonly runs: readonly MeasurementRun[];
    readonly acrossRuns: AcrossRuns;
    readonly skippedArtifacts: readonly SkippedArtifact[];
    readonly notComputable: readonly NotComputableFigure[];
};

/** A count keyed by the value that produced it, in sorted key order so two runs render the same bytes. */
export function countBy<TItem>(
    items: readonly TItem[],
    key: (item: TItem) => string | undefined
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
        const name = key(item);
        if (name === undefined) {
            continue;
        }
        counts[name] = (counts[name] ?? 0) + 1;
    }
    return sortedCounts(counts);
}

export function sortedCounts(counts: Readonly<Record<string, number>>): Record<string, number> {
    const sorted: Record<string, number> = {};
    for (const name of Object.keys(counts).sort()) {
        sorted[name] = counts[name] ?? 0;
    }
    return sorted;
}

export function sumCounts(into: Record<string, number>, from: Readonly<Record<string, number>>, times = 1): void {
    for (const [name, count] of Object.entries(from)) {
        into[name] = (into[name] ?? 0) + count * times;
    }
}

/** Two count records folded into one, with neither input mutated. */
export function mergeCounts(
    left: Readonly<Record<string, number>>,
    right: Readonly<Record<string, number>>
): Record<string, number> {
    const merged: Record<string, number> = {};
    sumCounts(merged, left);
    sumCounts(merged, right);
    return sortedCounts(merged);
}

export function emptyNotAskedReasons(): Record<RuleNotAskedReason, number> {
    return {
        'missing-required-evidence': 0,
        'no-answerable-question': 0,
        'omitted-for-budget-or-deadline': 0,
        'provider-failure': 0,
        'dry-run': 0,
    };
}

export function emptyScopeStates(): Record<keyof SemanticScopeStates, number> {
    return {
        notApplicable: 0,
        excludedWithAssessmentOwed: 0,
        missingRequiredEvidence: 0,
        omittedForBudgetOrDeadline: 0,
        providerFailure: 0,
        dryRun: 0,
    };
}

export function addStates(into: Record<keyof SemanticScopeStates, number>, from: SemanticScopeStates): void {
    for (const name of Object.keys(into) as (keyof SemanticScopeStates)[]) {
        into[name] += from[name];
    }
}
