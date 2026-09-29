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
    type MeasurementMachine,
    type MeasurementRecord,
    type MeasurementRun,
    type MeasurementSources,
    type NotComputableFigure,
    type RecordExtras,
    type RepeatedWarning,
    type ReviewRoundSummary,
    type RuleNotAskedReason,
    type RunUsage,
    type SkippedArtifact,
    RULE_NOT_ASKED_REASONS,
    SEMANTIC_MEASUREMENT_FORMAT,
    SEMANTIC_MEASUREMENT_SCHEMA_VERSION,
} from './contracts.ts';

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

function sumDossiers(runs: readonly MeasurementRun[]): AcrossRuns['reviewRounds'] {
    const dossiers = runs.flatMap((run) => run.reviewRounds);
    const total = (pick: (round: ReviewRoundSummary) => number): number =>
        dossiers.reduce((sum, round) => sum + pick(round), 0);
    return {
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
        usage.actualInputTokens += run.usage.actualInputTokens;
        usage.estimatedInputTokens += run.usage.estimatedInputTokens;
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
    dispositions: number;
    dismissed: number;
    undismissed: number;
    withoutDossier: number;
};

function sumSignals(runs: readonly MeasurementRun[]): SignalTotals {
    const totals: SignalTotals = {
        byDisposition: {},
        byFindingDisposition: {},
        dispositionTokens: {},
        signals: 0,
        fired: 0,
        dispositions: 0,
        dismissed: 0,
        undismissed: 0,
        withoutDossier: 0,
    };
    for (const run of runs) {
        if (run.signalOutcome !== null) {
            totals.signals += run.signalOutcome.totalSignals;
            totals.fired += run.signalOutcome.firedSignals.length;
            sumCounts(totals.byDisposition, run.signalOutcome.byDisposition);
            totals.dispositions += run.signalOutcome.dispositionsRecorded.length;
            sumCounts(
                totals.dispositionTokens,
                countBy(run.signalOutcome.dispositionsRecorded, (entry) => entry.disposition)
            );
            totals.dismissed += run.signalOutcome.dismissedFiredSignals;
            totals.undismissed += run.signalOutcome.undismissedFiredSignals.length;
            totals.withoutDossier += run.signalOutcome.firedSignalsWithoutDossier;
        }
        if (run.findingOutcome !== null) {
            sumCounts(totals.byFindingDisposition, run.findingOutcome.byDisposition);
        }
    }
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
    derived: SemanticScopeStates;
    published: SemanticScopeStates;
    publishedRuns: number;
} {
    const derived = emptyScopeStates();
    const published = emptyScopeStates();
    let publishedRuns = 0;
    for (const run of runs) {
        addStates(derived, run.outcomeAccounting.derivedFromEntries);
        if (run.outcomeAccounting.publishedStates !== null) {
            addStates(published, run.outcomeAccounting.publishedStates);
            publishedRuns += 1;
        }
    }
    return { derived, published, publishedRuns };
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

function sumLabelledExpectations(runs: readonly MeasurementRun[]): AcrossRuns['labelledExpectations'] {
    const labelled = runs.filter((run) => run.labelledExpectationHeld !== null);
    if (labelled.length === 0) {
        return null;
    }
    return {
        held: labelled.filter((run) => run.labelledExpectationHeld === true).length,
        total: labelled.length,
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
        usage: sumUsage(runs),
        wallClockMs: wallClock.wallClockMs,
        wallClockRuns: wallClock.wallClockRuns,
        derivedOutcomeStates: outcomes.derived,
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
            total: signals.signals,
            byDisposition: sortedCounts(signals.byDisposition),
            byRule: sortedCounts(extras.signalsByRule),
            fired: signals.fired,
            byFindingDisposition: sortedCounts(signals.byFindingDisposition),
        },
        signalDispositions: {
            recorded: signals.dispositions,
            byToken: sortedCounts(signals.dispositionTokens),
            dismissedFiredSignals: signals.dismissed,
            undismissedFiredSignals: signals.undismissed,
            withoutDossier: signals.withoutDossier,
        },
        reviewRounds: sumDossiers(runs),
        labelledExpectations: sumLabelledExpectations(runs),
        repeatedWarnings: repeatedWarnings(runs),
    };
}

/** The figures a skipped artifact would have contributed, named one by one so no gap reads as a zero. */
function skippedFigures(skipped: readonly SkippedArtifact[]): NotComputableFigure[] {
    return skipped.map((artifact) => ({
        figure: `every figure ${artifact.path} would contribute`,
        reason: `the artifact was skipped rather than read: ${artifact.reason}`,
    }));
}

type ScanShapeCounts = {
    scans: number;
    withoutStates: number;
    withoutOrder: number;
    verifyRuns: number;
    withoutRound: number;
    withoutDispositions: number;
};

/** What the scan runs do and do not carry, which decides which figures are not computable. */
function scanShape(runs: readonly MeasurementRun[]): ScanShapeCounts {
    const scans = runs.filter((run) => run.artifact.kind !== 'evaluation-fixture' && run.mode === 'scan');
    const scanRuns = runs.filter((run) => run.signalOutcome !== null);
    return {
        scans: scans.length,
        withoutStates: scans.filter((run) => run.outcomeAccounting.publishedStates === null).length,
        withoutOrder: scans.filter((run) => run.ruleCoverage?.applicableRulesComplete === false).length,
        verifyRuns: runs.filter((run) => run.ruleCoverage === null).length,
        withoutRound: scanRuns.filter((run) => (run.signalOutcome?.dossiersMatched.length ?? 0) === 0).length,
        withoutDispositions: runs.filter(
            (run) =>
                (run.signalOutcome?.dossiersMatched.length ?? 0) > 0 &&
                run.signalOutcome?.dispositionsRecorded.length === 0
        ).length,
    };
}

function gapFigures(runs: readonly MeasurementRun[]): NotComputableFigure[] {
    const figures: NotComputableFigure[] = [];
    const shape = scanShape(runs);
    if (shape.withoutStates > 0) {
        figures.push({
            figure: 'runs[].outcomeAccounting.publishedStates',
            reason: `${String(shape.withoutStates)} stored scan report(s) were written before scope.states existed; their omission totals here are derived from their own excluded and unassessed entries`,
        });
    }
    if (shape.withoutOrder > 0) {
        figures.push({
            figure: 'runs[].ruleCoverage.applicableRules',
            reason: `${String(shape.withoutOrder)} stored scan report(s) carry no scope.requestOrder, so the rule set of each unit omitted before admission is in no artifact; those runs' applicable counts are floors over the units whose rules the report publishes, and their notAskedByReason under-counts an omission whose rules are unpublished`,
        });
    }
    const withoutWallClock = runs.filter((run) => run.wallClock === null).length;
    if (withoutWallClock > 0) {
        figures.push({
            figure: 'runs[].wallClock',
            reason: `${String(withoutWallClock)} artifact(s) record no start and end — an evaluation outcome reports a fixture's answers, not its clock — so no span exists for them`,
        });
    }
    const withoutTruncation = runs.filter((run) => run.evidenceCompleteness.truncatedRegions === null).length;
    if (withoutTruncation > 0) {
        figures.push({
            figure: 'runs[].evidenceCompleteness.truncatedRegions',
            reason: `${String(withoutTruncation)} artifact(s) carry no truncation ledger; nothing recorded whether evidence was cut, which is not the same as none being cut`,
        });
    }
    if (shape.verifyRuns > 0) {
        figures.push({
            figure: 'runs[].ruleCoverage for verification runs',
            reason: `${String(shape.verifyRuns)} verification run(s) assess candidate findings rather than rule applicability; no artifact records which rules would have applied to the change`,
        });
    }
    const noPr = runs.filter(
        (run) => run.context.prNumber === null && run.artifact.kind !== 'evaluation-fixture'
    ).length;
    if (noPr > 0) {
        figures.push({
            figure: 'acrossRuns.repeatedWarnings',
            reason: `${String(noPr)} run(s) name no pull request, so a signal repeated across their heads cannot be attributed to one pull request`,
        });
    }
    const withoutDossier = runs.reduce((sum, run) => sum + (run.signalOutcome?.firedSignalsWithoutDossier ?? 0), 0);
    if (withoutDossier > 0) {
        figures.push({
            figure: 'acrossRuns.signalDispositions.undismissedFiredSignals',
            reason: `${String(withoutDossier)} fired signal(s) sit on a head with no stored dossier, so whether the round disposed of them is in no artifact`,
        });
    }
    if (shape.withoutRound > 0) {
        figures.push({
            figure: 'runs[].reviewRounds',
            reason: `${String(shape.withoutRound)} scan run(s) have no stored dossier for their head, so the round's draws, findings and typed dispositions are absent rather than zero`,
        });
    }
    if (shape.withoutDispositions > 0) {
        figures.push({
            figure: 'runs[].signalOutcome.dispositionsRecorded',
            reason: `${String(shape.withoutDispositions)} run(s) matched a dossier that records no typed disposition for this head — a historical record written before the field existed, or a round that disposed by citation text alone`,
        });
    }
    return figures;
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
        'scan.json #signals[].{path,ruleId,missingEvidence}, #scope.requestOrder[].ruleIds, and #scope.unassessed[].reason; not computable for a verification run, which assesses findings rather than rule applicability',
    'runs[].evidenceCompleteness':
        'scan.json #signals[].missingEvidence and #scope.truncated[].reason; verification.json #findingAssessments[].disposition; an evaluation outcome has no truncation ledger',
    'runs[].outcomeAccounting':
        'scan.json #scope.states as published, and #scope.{excluded,unassessed} re-derived here by the same function the report validator holds the published block to',
    'runs[].signalOutcome':
        'scan.json #signals[].disposition, and .agents/review-bundles/<pr>-<head>/dossier.json #signalDispositions or a literal semantic-signal token',
    'runs[].findingOutcome': 'verification.json #findingAssessments[].{disposition,escalate}',
    'runs[].reviewRounds':
        '.agents/review-bundles/<pr>-<head>/dossier.json #events, #recommendation, #assessmentImpact',
    'runs[].labelledExpectationHeld':
        "the evaluation runner's own #expectedConcernHeld per fixture: a count of labelled expectations that held, over the rules under test, never an accuracy figure",
    acrossRuns: 'the sum of the same figure over every run whose artifact carried it',
    'acrossRuns.wallClockMs': "the sum of the runs' own spans, over the runs that recorded one",
    'acrossRuns.repeatedWarnings':
        'the same (ruleId, path) fired on more than one distinct head of one pull request, keyed by repository and pull request number',
    'acrossRuns.evidence.limitationsByText':
        "each run artifact's own #limitations, one entry per distinct text with the number of runs that recorded it",
    'acrossRuns.ruleCoverage.notAskedByRule':
        'the same rule set the coverage figures count, read once for the whole set rather than repeated per run',
    'acrossRuns.signals.byRule': "each run artifact's own #signals[].ruleId, counted across the set",
    'acrossRuns.labelledExpectations':
        "the evaluation runner's own #expectedConcernHeld count over the fixtures it ran",
    skippedArtifacts:
        'artifacts present on disk that the report validator or the dossier reader refused, with its message',
};

export function buildMeasurementRecord(input: {
    readonly measuredAt: string;
    readonly machine: MeasurementMachine;
    readonly sources: MeasurementSources;
    readonly runs: readonly MeasurementRun[];
    readonly skippedArtifacts: readonly SkippedArtifact[];
    readonly extras?: RecordExtras;
}): MeasurementRecord {
    return {
        format: SEMANTIC_MEASUREMENT_FORMAT,
        schemaVersion: SEMANTIC_MEASUREMENT_SCHEMA_VERSION,
        measuredAt: input.measuredAt,
        machine: input.machine,
        advisory: ADVISORY,
        fieldSources: FIELD_SOURCES,
        sources: input.sources,
        runs: [...input.runs],
        acrossRuns: acrossRuns(input.runs, input.extras ?? emptyRecordExtras()),
        skippedArtifacts: [...input.skippedArtifacts],
        notComputable: [...skippedFigures(input.skippedArtifacts), ...gapFigures(input.runs)],
    };
}
