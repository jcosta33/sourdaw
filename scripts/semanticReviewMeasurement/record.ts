/**
 * What a set of runs says together: the across-run figures, the figures no artifact could support, and
 * the assembled record.
 *
 * Every total here is the sum of the same figure over the runs whose artifact carried it, and every
 * gap is named in `notComputable` rather than left as a zero. The sum never invents a value: a run
 * whose artifact recorded no truncation ledger contributes to `runsWithoutTruncationLedger`, not to
 * `truncatedRegions`.
 */

import { type SemanticScopeStates } from '../semanticReview/scopeAccounting.ts';

import { emptyRecordExtras } from './artifacts.ts';
import {
    addStates,
    countBy,
    emptyNotAskedReasons,
    emptyScopeStates,
    sortedCounts,
    sumCounts,
    type AcrossRuns,
    type FiredSignal,
    type MeasurementDetail,
    type MeasurementMachine,
    type MeasurementRecord,
    type MeasurementRun,
    type MeasurementSources,
    type RecordExtras,
    type RecordedSignalDisposition,
    type RepeatedWarning,
    type ReviewRoundSummary,
    type RuleNotAskedReason,
    type RunUsage,
    type SkippedArtifact,
    RULE_NOT_ASKED_REASONS,
    SEMANTIC_MEASUREMENT_FORMAT,
    SEMANTIC_MEASUREMENT_SCHEMA_VERSION,
} from './contracts.ts';
import { notComputableFigures } from './gaps.ts';

type CoverageTotals = {
    applicable: number;
    complete: boolean;
    unpublishedUnits: number;
    asked: number;
    notAsked: number;
    reasons: Record<RuleNotAskedReason, number>;
    runsWithout: number;
};

function sumRuleCoverage(runs: readonly MeasurementRun[]): CoverageTotals {
    const totals: CoverageTotals = {
        applicable: 0,
        complete: true,
        unpublishedUnits: 0,
        asked: 0,
        notAsked: 0,
        reasons: emptyNotAskedReasons(),
        runsWithout: 0,
    };
    for (const run of runs) {
        const coverage = run.ruleCoverage;
        if (coverage === null) {
            totals.runsWithout += 1;
            continue;
        }
        totals.applicable += coverage.applicableRules;
        totals.complete = totals.complete && coverage.applicableRulesComplete;
        totals.unpublishedUnits += coverage.unitsWithUnpublishedRuleSets;
        totals.asked += coverage.askedRules;
        totals.notAsked += coverage.notAskedRules;
        for (const reason of RULE_NOT_ASKED_REASONS) {
            totals.reasons[reason] += coverage.notAskedByReason[reason];
        }
    }
    return totals;
}

/**
 * The same (ruleId, path) flagged on more than one head of one pull request. A run that names no pull
 * request cannot take part: nothing ties its head to the request the pair would repeat on.
 */
function repeatedWarnings(runs: readonly MeasurementRun[]): RepeatedWarning[] {
    const seen = new Map<string, { warning: RepeatedWarning; heads: Set<string> }>();
    for (const run of runs) {
        const { repository, prNumber, headSha } = run.context;
        for (const signal of run.signalOutcome?.firedSignals ?? []) {
            if (repository === null || prNumber === null || headSha === null) {
                continue;
            }
            const key = [repository, String(prNumber), signal.ruleId, signal.path].join('\u0000');
            const entry = seen.get(key) ?? {
                warning: { repository, prNumber, ruleId: signal.ruleId, path: signal.path, heads: [] },
                heads: new Set<string>(),
            };
            entry.heads.add(headSha);
            seen.set(key, entry);
        }
    }
    const repeated: RepeatedWarning[] = [];
    for (const entry of seen.values()) {
        if (entry.heads.size > 1) {
            repeated.push({ ...entry.warning, heads: [...entry.heads].sort() });
        }
    }
    return repeated.sort((left, right) => left.prNumber - right.prNumber || left.path.localeCompare(right.path));
}

/**
 * One round per (pull request, head), however many artifacts name it.
 *
 * The normal flow stores a scan and a verification sidecar under one head, so both runs match the same
 * dossier; summing each run's rounds would count that head's draws and findings twice. The identity is
 * the pair the dossier binds, not the path it happens to sit at.
 */
function distinctRounds(runs: readonly MeasurementRun[]): ReviewRoundSummary[] {
    const byHead = new Map<string, ReviewRoundSummary>();
    for (const run of runs) {
        for (const round of run.reviewRounds) {
            const key = `${String(round.pr)}\u0000${round.headSha}`;
            const seen = byHead.get(key);
            if (seen === undefined || round.path.localeCompare(seen.path) < 0) {
                byHead.set(key, round);
            }
        }
    }
    return [...byHead.values()];
}

function sumDossiers(runs: readonly MeasurementRun[]): AcrossRuns['reviewRounds'] {
    const dossiers = distinctRounds(runs);
    const total = (pick: (round: ReviewRoundSummary) => number): number =>
        dossiers.reduce((sum, round) => sum + pick(round), 0);
    return {
        heads: dossiers.length,
        dossiers: dossiers.length,
        stanceDraws: total((round) => round.stanceDraws),
        findingsAccepted: total((round) => round.findingsAccepted),
        findingsDiscarded: total((round) => round.findingsDiscarded),
        reviewsPublished: total((round) => round.reviewsPublished),
    };
}

/** The usage totals every run's own block adds up to. */
function sumUsage(runs: readonly MeasurementRun[]): RunUsage {
    const usage = {
        networkAttempts: 0,
        logicalRequests: 0,
        retries: 0,
        submittedBytes: 0,
        actualInputTokens: 0,
        estimatedInputTokens: 0,
        attemptsWithUnknownUsage: 0,
        estimatedCostUsd: 0,
        pricingConfigurationVersion: '',
        cacheHits: 0,
    };
    for (const run of runs) {
        usage.networkAttempts += run.usage.networkAttempts;
        usage.logicalRequests += run.usage.logicalRequests;
        usage.retries += run.usage.retries;
        usage.submittedBytes += run.usage.submittedBytes;
        const actualInputTokens = usage.actualInputTokens + run.usage.actualInputTokens;
        if (!Number.isSafeInteger(actualInputTokens)) {
            throw new RangeError('aggregate actualInputTokens must remain a non-negative safe integer');
        }
        usage.actualInputTokens = actualInputTokens;
        const estimatedInputTokens = usage.estimatedInputTokens + run.usage.estimatedInputTokens;
        if (!Number.isSafeInteger(estimatedInputTokens)) {
            throw new RangeError('aggregate estimatedInputTokens must remain a non-negative safe integer');
        }
        usage.estimatedInputTokens = estimatedInputTokens;
        usage.attemptsWithUnknownUsage += run.usage.attemptsWithUnknownUsage;
        usage.estimatedCostUsd += run.usage.estimatedCostUsd;
        usage.cacheHits += run.usage.cacheHits;
        if (run.usage.pricingConfigurationVersion !== '') {
            usage.pricingConfigurationVersion = run.usage.pricingConfigurationVersion;
        }
    }
    return usage;
}

type SignalTotals = {
    byDisposition: Record<string, number>;
    byFindingDisposition: Record<string, number>;
    dispositionTokens: Record<string, number>;
    signals: number;
    fired: number;
    runsWithSignalLedger: number;
    runsWithFindingLedger: number;
    dispositions: number;
    dismissed: number;
    undismissed: number;
    withoutDossier: number;
};

/** The identity of one fired signal on the head it fired on, however many sidecars that head has. */
function firedSignalKey(run: MeasurementRun, signal: FiredSignal): string {
    const { repository, prNumber, headSha } = run.context;
    const head = headSha ?? run.artifact.path;
    return [repository ?? '', String(prNumber ?? ''), head, signal.ruleId, signal.path].join('\u0000');
}

/**
 * What the rounds recorded, counted once per head.
 *
 * One head is normally read by several sidecars — a scan and a verification report at least — and each
 * run matches the same dossier. Counting each run's dispositions and dismissals would multiply one
 * round's outcomes by the number of artifacts that happen to name that head, so they are keyed by the
 * head and the signal, and the recorded dispositions by the dossier that holds them. The per-run signal
 * counts above stay per run: those measure what was asked, not what a round disposed of.
 */
function sumDisposals(runs: readonly MeasurementRun[]): {
    dispositions: Map<string, RecordedSignalDisposition>;
    fired: Map<string, boolean>;
    withoutDossier: Set<string>;
} {
    const dispositions = new Map<string, RecordedSignalDisposition>();
    const fired = new Map<string, boolean>();
    const withoutDossier = new Set<string>();
    for (const run of runs) {
        const outcome = run.signalOutcome;
        if (outcome === null) {
            continue;
        }
        for (const entry of outcome.dispositionsRecorded) {
            dispositions.set(`${entry.dossier}\u0000${entry.ruleId}\u0000${entry.path}`, entry);
        }
        const hasDossier = outcome.dossiersMatched.length > 0;
        const undismissedHere = new Set(outcome.undismissedFiredSignals.map((signal) => firedSignalKey(run, signal)));
        for (const signal of outcome.firedSignals) {
            const key = firedSignalKey(run, signal);
            if (!hasDossier) {
                withoutDossier.add(key);
                continue;
            }
            fired.set(key, (fired.get(key) ?? true) && !undismissedHere.has(key));
        }
    }
    return { dispositions, fired, withoutDossier };
}

function sumSignals(runs: readonly MeasurementRun[]): SignalTotals {
    const totals: SignalTotals = {
        byDisposition: {},
        byFindingDisposition: {},
        dispositionTokens: {},
        signals: 0,
        fired: 0,
        runsWithSignalLedger: 0,
        runsWithFindingLedger: 0,
        dispositions: 0,
        dismissed: 0,
        undismissed: 0,
        withoutDossier: 0,
    };
    for (const run of runs) {
        if (run.signalOutcome !== null) {
            totals.runsWithSignalLedger += 1;
            totals.signals += run.signalOutcome.totalSignals;
            totals.fired += run.signalOutcome.firedSignals.length;
            sumCounts(totals.byDisposition, run.signalOutcome.byDisposition);
        }
        if (run.findingOutcome !== null) {
            totals.runsWithFindingLedger += 1;
            sumCounts(totals.byFindingDisposition, run.findingOutcome.byDisposition);
        }
    }
    const disposals = sumDisposals(runs);
    totals.dispositions = disposals.dispositions.size;
    sumCounts(
        totals.dispositionTokens,
        countBy([...disposals.dispositions.values()], (entry) => entry.disposition)
    );
    for (const dismissed of disposals.fired.values()) {
        if (dismissed) {
            totals.dismissed += 1;
        } else {
            totals.undismissed += 1;
        }
    }
    totals.withoutDossier = disposals.withoutDossier.size;
    return totals;
}

type EvidenceTotals = {
    unitsMissingRequiredEvidence: number;
    requiredEvidenceTokensMissing: Record<string, number>;
    truncatedRegions: number;
    truncatedPaths: number;
    truncationReasons: Record<string, number>;
    runsWithoutTruncationLedger: number;
};

function sumEvidence(runs: readonly MeasurementRun[]): EvidenceTotals {
    const totals: EvidenceTotals = {
        unitsMissingRequiredEvidence: 0,
        requiredEvidenceTokensMissing: {},
        truncatedRegions: 0,
        truncatedPaths: 0,
        truncationReasons: {},
        runsWithoutTruncationLedger: 0,
    };
    for (const run of runs) {
        const evidence = run.evidenceCompleteness;
        totals.unitsMissingRequiredEvidence += evidence.unitsMissingRequiredEvidence;
        sumCounts(totals.requiredEvidenceTokensMissing, evidence.requiredEvidenceTokensMissing);
        if (evidence.truncatedRegions === null) {
            totals.runsWithoutTruncationLedger += 1;
            continue;
        }
        totals.truncatedRegions += evidence.truncatedRegions;
        totals.truncatedPaths += evidence.truncatedPaths ?? 0;
        sumCounts(totals.truncationReasons, evidence.truncationReasons ?? {});
    }
    return totals;
}

function sumOutcomes(runs: readonly MeasurementRun[]): {
    derived: SemanticScopeStates | null;
    derivedRuns: number;
    published: SemanticScopeStates | null;
    publishedRuns: number;
} {
    const derived = emptyScopeStates();
    const published = emptyScopeStates();
    let derivedRuns = 0;
    let publishedRuns = 0;
    for (const run of runs) {
        // Null is an artifact that cannot report the ledger, never a ledger of zeros; the counts below
        // are what keeps an absent ledger from reading as a run that omitted nothing.
        if (run.outcomeAccounting.derivedFromEntries !== null) {
            addStates(derived, run.outcomeAccounting.derivedFromEntries);
            derivedRuns += 1;
        }
        if (run.outcomeAccounting.publishedStates !== null) {
            addStates(published, run.outcomeAccounting.publishedStates);
            publishedRuns += 1;
        }
    }
    return {
        derived: derivedRuns === 0 ? null : derived,
        derivedRuns,
        published: publishedRuns === 0 ? null : published,
        publishedRuns,
    };
}

function sumWallClock(runs: readonly MeasurementRun[]): { wallClockMs: number; wallClockRuns: number } {
    let wallClockMs = 0;
    let wallClockRuns = 0;
    for (const run of runs) {
        if (run.wallClock === null) {
            continue;
        }
        wallClockMs += run.wallClock.durationMs;
        wallClockRuns += 1;
    }
    return { wallClockMs, wallClockRuns };
}

/**
 * The runner's own held-label count, over the fixtures that asked the rule their label is about.
 *
 * A label is evidence only when the fixture produced an answer to it, which takes both facts the record
 * carries: the runner assessed the fixture at all — a fixture it did not assess carries a label the
 * runner already read as not held, because it reads an absent answer as a wrong one — and the fixture's
 * own ledger asked its labelled rule. A finished run whose question was never put is the same absent
 * answer as an unassessed run, so either gap lands the fixture in `notAssessed`, and the held rate is
 * over the fixtures that both completed and asked.
 */
function sumLabelledExpectations(runs: readonly MeasurementRun[]): AcrossRuns['labelledExpectations'] {
    const labelled = runs.filter((run) => run.labelledExpectationHeld !== null);
    if (labelled.length === 0) {
        return null;
    }
    const assessed = labelled.filter((run) => run.execution === 'completed' && run.labelledRuleAsked === true);
    return {
        held: assessed.filter((run) => run.labelledExpectationHeld === true).length,
        total: assessed.length,
        notAssessed: labelled.length - assessed.length,
    };
}

/**
 * What the rounds disposed of, or null figures when no artifact read carries a signal ledger.
 *
 * A verification-only measurement fires no signal, so no round could dispose of one; a row of zeros
 * would read as a round that dismissed nothing, the same silent zero `signals.total` no longer
 * publishes. `signals.runsWithSignalLedger` names how many runs carried the ledger, and the gap is
 * named in `notComputable`.
 */
function summedDispositions(signals: SignalTotals): AcrossRuns['signalDispositions'] {
    if (signals.runsWithSignalLedger === 0) {
        return {
            recorded: null,
            byToken: null,
            dismissedFiredSignals: null,
            undismissedFiredSignals: null,
            withoutDossier: null,
        };
    }
    return {
        recorded: signals.dispositions,
        byToken: sortedCounts(signals.dispositionTokens),
        dismissedFiredSignals: signals.dismissed,
        undismissedFiredSignals: signals.undismissed,
        withoutDossier: signals.withoutDossier,
    };
}

function acrossRuns(runs: readonly MeasurementRun[], extras: RecordExtras): AcrossRuns {
    const coverage = sumRuleCoverage(runs);
    const evidence = sumEvidence(runs);
    const signals = sumSignals(runs);
    const outcomes = sumOutcomes(runs);
    const wallClock = sumWallClock(runs);
    return {
        runCount: runs.length,
        runCountByKind: countBy(runs, (run) => run.artifact.kind),
        executionStates: countBy(runs, (run) => run.execution),
        failureCodes: countBy(
            runs.filter((run) => run.failureCode !== null),
            (run) => run.failureCode ?? undefined
        ),
        usage: sumUsage(runs),
        wallClockMs: wallClock.wallClockMs,
        wallClockRuns: wallClock.wallClockRuns,
        derivedOutcomeStates: outcomes.derived,
        derivedOutcomeRuns: outcomes.derivedRuns,
        publishedOutcomeStates: outcomes.published,
        publishedOutcomeRuns: outcomes.publishedRuns,
        ruleCoverage: {
            applicableRules: coverage.applicable,
            applicableRulesCompleteEverywhere: coverage.complete,
            unitsWithUnpublishedRuleSets: coverage.unpublishedUnits,
            askedRules: coverage.asked,
            notAskedRules: coverage.notAsked,
            notAskedByReason: coverage.reasons,
            notAskedByRule: sortedCounts(extras.notAskedByRule),
            runsWithoutRuleCoverage: coverage.runsWithout,
        },
        evidence: {
            ...evidence,
            requiredEvidenceTokensMissing: sortedCounts(evidence.requiredEvidenceTokensMissing),
            truncationReasons: sortedCounts(evidence.truncationReasons),
            limitationsByText: sortedCounts(extras.limitationsByText),
        },
        signals: {
            runsWithSignalLedger: signals.runsWithSignalLedger,
            runsWithFindingLedger: signals.runsWithFindingLedger,
            // An empty ledger is null with the contributing-run count beside it, so the zero a
            // verification-only measurement would otherwise publish cannot read as a run that asked
            // nothing and found nothing.
            total: signals.runsWithSignalLedger === 0 ? null : signals.signals,
            byDisposition: signals.runsWithSignalLedger === 0 ? null : sortedCounts(signals.byDisposition),
            byRule: signals.runsWithSignalLedger === 0 ? null : sortedCounts(extras.signalsByRule),
            fired: signals.runsWithSignalLedger === 0 ? null : signals.fired,
            byFindingDisposition:
                signals.runsWithFindingLedger === 0 ? null : sortedCounts(signals.byFindingDisposition),
        },
        signalDispositions: summedDispositions(signals),
        reviewRounds: sumDossiers(runs),
        labelledExpectations: sumLabelledExpectations(runs),
        repeatedWarnings: repeatedWarnings(runs),
    };
}

const ADVISORY = [
    'This record measures what the advisory semantic review cost and what its artifacts returned.',
    'A returned probability is a model answer, never an accuracy figure; a question no request asked is counted as not asked, never as a correct negative.',
].join(' ');

/** Where each figure in the record came from, stated once for the whole record rather than per run. */
const FIELD_SOURCES: Readonly<Record<string, string>> = {
    'runs[].artifact':
        "the sidecar path, and a sha256 over that file's own bytes, so a figure is bound to the artifact it was read from",
    'runs[].runId/execution/failureCode': "the stored report's own #runId, #execution, #failureCode",
    'runs[].context': "the stored report's own #context (repository, prNumber, headSha, mergeBaseSha, evidenceProfile)",
    'runs[].models': "the stored report's own #requestedModel and #returnedModels",
    'runs[].wallClock': "the stored report's own #startedAt and #completedAt, stated as the run's own span",
    'runs[].usage': "the stored report's own #usage block plus #scope.cacheHits",
    'runs[].ruleCoverage':
        "scan.json #signals[].{path,ruleId,missingEvidence}, #scope.requestOrder[].ruleIds, and #scope.unassessed[].reason; an evaluation outcome's #outcomes[].ruleId with #missingEvidenceByRule, and #rulesNotAsked[].{ruleId,missingEvidence} for a rule no outcome carries; not computable for a verification run, which assesses findings rather than rule applicability",
    'runs[].evidenceCompleteness':
        'scan.json #signals[].missingEvidence and #scope.truncated[].reason; verification.json #findingAssessments[].disposition; an evaluation outcome has no truncation ledger',
    'runs[].outcomeAccounting':
        'scan.json #scope.states as published, and #scope.{excluded,unassessed} re-derived here by the same function the report validator holds the published block to; both null for an artifact that carries no scope ledger, which is named in notComputable rather than shown as zeros',
    'runs[].signalOutcome':
        "scan.json #signals[].disposition or an evaluation outcome's #outcomes[].disposition, and .agents/review-bundles/<pr>-<head>/dossier.json #signalDispositions or a literal semantic-signal token",
    'runs[].findingOutcome': 'verification.json #findingAssessments[].{disposition,escalate}',
    'runs[].reviewRounds':
        '.agents/review-bundles/<pr>-<head>/dossier.json #events, #recommendation, #assessmentImpact',
    'runs[].labelledExpectationHeld':
        "the evaluation runner's own #expectedConcernHeld per fixture: a count of labelled expectations that held, over the rules under test, never an accuracy figure",
    'runs[].labelledRuleAsked':
        "the evaluation runner's own #outcomes[].ruleId and #missingEvidenceByRule: whether the fixture's own ledger asked the #ruleId it labelled, which decides whether its label counts at all",
    acrossRuns:
        'the sum of the same figure over every run whose artifact carried it; a figure no artifact carried is null and is named in notComputable, and the runs that did carry it are counted beside it',
    'acrossRuns.executionStates':
        "each run artifact's own #execution, counted: a partial, unavailable, cancelled or skipped run is named here rather than reading as completed",
    'acrossRuns.failureCodes': "each run artifact's own #failureCode, counted over the runs that carry one",
    'acrossRuns.reviewRounds':
        'dossiers deduplicated by (pull request, head) before summing: a head with both a scan and a verification sidecar is one round, and acrossRuns.reviewRounds.heads names how many distinct heads those are',
    'acrossRuns.wallClockMs': "the sum of the runs' own spans, over the runs that recorded one",
    'acrossRuns.repeatedWarnings':
        'the same (ruleId, path) fired on more than one distinct head of one pull request, keyed by repository and pull request number',
    'acrossRuns.evidence.limitationsByText':
        "each run artifact's own #limitations, one entry per distinct text with the number of runs that recorded it",
    'acrossRuns.ruleCoverage.notAskedByRule':
        'the same rule set the coverage figures count, read once for the whole set rather than repeated per run',
    'acrossRuns.signals.byRule':
        "each run artifact's own #signals[].ruleId or an evaluation outcome's #outcomes[].ruleId, counted once per run across the set",
    'acrossRuns.signals.byDisposition':
        "each run artifact's own #signals[].disposition or an evaluation outcome's #outcomes[].disposition, counted once per run across the set; null when no run carried a signal ledger",
    'acrossRuns.signals.runsWithSignalLedger':
        'the runs that carry a signal ledger at all: a scan report or an evaluation outcome; a verification report assesses findings instead',
    'acrossRuns.signals.byFindingDisposition':
        "each verification report's own #findingAssessments[].disposition, counted across the set; null when no run carried a finding ledger",
    'acrossRuns.signalDispositions':
        'the typed dispositions and the dismissed signals, counted once per (pull request, head) however many sidecars that head has, from each matched dossier and from the literal semantic-signal token; every figure is null when no artifact read carries a signal ledger, which is named in notComputable rather than shown as zeros',
    'acrossRuns.labelledExpectations':
        "the evaluation runner's own #expectedConcernHeld count over the fixtures whose own ledger asked the rule they labelled; a fixture that never asked it, or that the runner never assessed, is counted in notAssessed instead",
    skippedArtifacts:
        'artifacts present on disk that the report validator or the dossier reader refused, with its message',
};

/**
 * The legend for the detail level the record was measured at. At the aggregate level the per-run
 * entries are absent by choice rather than by accident, and the map says so instead of describing
 * fields the record does not carry.
 */
function fieldSourcesFor(detail: MeasurementDetail): Record<string, string> {
    if (detail === 'runs') {
        return FIELD_SOURCES;
    }
    const sources: Record<string, string> = {};
    for (const [field, source] of Object.entries(FIELD_SOURCES)) {
        if (!field.startsWith('runs[')) {
            sources[field] = source;
        }
    }
    sources['runs[]'] =
        'not published at this detail level: the record was measured with the aggregate detail level, which carries the across-run figures and the gaps; measure again with --detail for one entry per run';
    return sources;
}

export function buildMeasurementRecord(input: {
    readonly measuredAt: string;
    readonly machine: MeasurementMachine;
    readonly sources: MeasurementSources;
    readonly runs: readonly MeasurementRun[];
    readonly skippedArtifacts: readonly SkippedArtifact[];
    readonly extras?: RecordExtras;
}): MeasurementRecord {
    const { detail } = input.sources;
    return {
        format: SEMANTIC_MEASUREMENT_FORMAT,
        schemaVersion: SEMANTIC_MEASUREMENT_SCHEMA_VERSION,
        measuredAt: input.measuredAt,
        machine: input.machine,
        advisory: ADVISORY,
        fieldSources: fieldSourcesFor(detail),
        sources: input.sources,
        runs: detail === 'runs' ? [...input.runs] : [],
        acrossRuns: acrossRuns(input.runs, input.extras ?? emptyRecordExtras()),
        skippedArtifacts: [...input.skippedArtifacts],
        notComputable: notComputableFigures(input.runs, detail, input.skippedArtifacts),
    };
}
