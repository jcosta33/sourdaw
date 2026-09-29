/**
 * Every figure this record could not compute, and why, so no gap reads as a zero.
 *
 * A skipped artifact contributes no figure at all; an artifact that carries no ledger for a figure
 * contributes nothing to it; and an empty sum is named with the count of runs that did carry the
 * ledger, so a zero can never be mistaken for "nothing happened". The gaps are derived here rather
 * than beside the sums because a missing figure and a zero figure are the same number to a reader.
 */

import {
    type MeasurementDetail,
    type MeasurementRun,
    type NotComputableFigure,
    type SkippedArtifact,
} from './contracts.ts';

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

/**
 * The field a gap is named against. At the full detail level that is the per-run field itself; at the
 * aggregate level the record carries no per-run entries, so the gap is named against the total it
 * leaves short.
 */
function gapFigure(detail: MeasurementDetail, runField: string, totalField: string): string {
    return detail === 'runs' ? runField : totalField;
}

/**
 * The gaps an artifact's own ledger leaves: the omission states it never recorded, the signals and
 * findings it does not carry, the head it does not name, and the round it does not hold. Each is named
 * with the count of runs that did carry the ledger, so an empty sum is never read as a zero.
 */
function ledgerGaps(runs: readonly MeasurementRun[], detail: MeasurementDetail): NotComputableFigure[] {
    const figures: NotComputableFigure[] = [];
    const shape = scanShape(runs);
    const withoutLedger = runs.filter((run) => run.outcomeAccounting.derivedFromEntries === null).length;
    if (withoutLedger > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].outcomeAccounting.derivedFromEntries', 'acrossRuns.derivedOutcomeStates'),
            reason: `${String(withoutLedger)} artifact(s) carry no scope ledger — an evaluation outcome reports what a fixture asked and what came back, not which units were omitted — so the omission totals here are over the runs that do, and acrossRuns.derivedOutcomeRuns names how many those are`,
        });
    }
    const withoutSignalLedger = runs.filter((run) => run.signalOutcome === null).length;
    if (withoutSignalLedger > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].signalOutcome', 'acrossRuns.signals'),
            reason: `${String(withoutSignalLedger)} verification run(s) assess candidate findings rather than units, so they carry no signal ledger; acrossRuns.signals.runsWithSignalLedger names how many runs do, and the signal figures are null when none does`,
        });
    }
    if (runs.length === withoutSignalLedger) {
        // Nothing fired, so nothing could be disposed of: the dispositions block is null rather than a
        // row of zeros however many dossiers were read.
        figures.push({
            figure: 'acrossRuns.signalDispositions',
            reason: `no artifact read carries a signal ledger, so no fired signal could be disposed of; every figure in the dispositions block is null rather than zero`,
        });
    }
    const withoutFindingLedger = runs.filter((run) => run.findingOutcome === null).length;
    if (withoutFindingLedger > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].findingOutcome', 'acrossRuns.signals.byFindingDisposition'),
            reason: `${String(withoutFindingLedger)} run(s) assess units rather than candidate findings, so they carry no finding ledger; acrossRuns.signals.runsWithFindingLedger names how many runs do`,
        });
    }
    const withoutContext = runs.filter((run) => run.context.repository === null).length;
    if (withoutContext > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].context', 'acrossRuns.runCountByKind'),
            reason: `${String(withoutContext)} evaluation fixture(s) carry no revision context: the outcome file records the rules a fixture asked about, not the repository or head it was run over`,
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
            figure: gapFigure(detail, 'runs[].reviewRounds', 'acrossRuns.reviewRounds'),
            reason: `${String(shape.withoutRound)} scan run(s) have no stored dossier for their head, so the round's draws, findings and typed dispositions are absent rather than zero`,
        });
    }
    if (shape.withoutDispositions > 0) {
        figures.push({
            figure: gapFigure(
                detail,
                'runs[].signalOutcome.dispositionsRecorded',
                'acrossRuns.signalDispositions.recorded'
            ),
            reason: `${String(shape.withoutDispositions)} run(s) matched a dossier that records no typed disposition for this head — a historical record written before the field existed, or a round that disposed by citation text alone`,
        });
    }
    return figures;
}

function gapFigures(runs: readonly MeasurementRun[], detail: MeasurementDetail): NotComputableFigure[] {
    const figures: NotComputableFigure[] = [];
    const shape = scanShape(runs);
    if (shape.withoutStates > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].outcomeAccounting.publishedStates', 'acrossRuns.publishedOutcomeStates'),
            reason: `${String(shape.withoutStates)} stored scan report(s) were written before scope.states existed; their omission totals here are derived from their own excluded and unassessed entries`,
        });
    }
    if (shape.withoutOrder > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].ruleCoverage.applicableRules', 'acrossRuns.ruleCoverage.applicableRules'),
            reason: `${String(shape.withoutOrder)} stored scan report(s) carry no scope.requestOrder, so the rule set of each unit omitted before admission is in no artifact; those runs' applicable counts are floors over the units whose rules the report publishes, and their notAskedByReason under-counts an omission whose rules are unpublished`,
        });
    }
    const withoutWallClock = runs.filter((run) => run.wallClock === null).length;
    if (withoutWallClock > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].wallClock', 'acrossRuns.wallClockMs'),
            reason: `${String(withoutWallClock)} artifact(s) record no start and end — an evaluation outcome reports a fixture's answers, not its clock — so no span exists for them`,
        });
    }
    const withoutTruncation = runs.filter((run) => run.evidenceCompleteness.truncatedRegions === null).length;
    if (withoutTruncation > 0) {
        figures.push({
            figure: gapFigure(
                detail,
                'runs[].evidenceCompleteness.truncatedRegions',
                'acrossRuns.evidence.truncatedRegions'
            ),
            reason: `${String(withoutTruncation)} artifact(s) carry no truncation ledger; nothing recorded whether evidence was cut, which is not the same as none being cut`,
        });
    }
    if (shape.verifyRuns > 0) {
        figures.push({
            figure: gapFigure(detail, 'runs[].ruleCoverage for verification runs', 'acrossRuns.ruleCoverage'),
            reason: `${String(shape.verifyRuns)} verification run(s) assess candidate findings rather than rule applicability; no artifact records which rules would have applied to the change`,
        });
    }
    // The held rate is null exactly when no artifact carried a label, which only an evaluation fixture
    // can: this is the same predicate `sumLabelledExpectations` returns null on, so the gap and the null
    // figure cannot disagree about whether any corpus was read.
    if (runs.every((run) => run.labelledExpectationHeld === null)) {
        figures.push({
            figure: gapFigure(detail, 'runs[].labelledExpectationHeld', 'acrossRuns.labelledExpectations'),
            reason: 'no evaluation artifact was read, so no fixture carried a labelled expectation; sources.evaluationFixturesRead names how many were read, and the held rate is null rather than a rate over nothing',
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
    return figures;
}

/** Every gap one record carries: the skipped artifacts first, then what the runs themselves lack. */
export function notComputableFigures(
    runs: readonly MeasurementRun[],
    detail: MeasurementDetail,
    skipped: readonly SkippedArtifact[]
): NotComputableFigure[] {
    return [...skippedFigures(skipped), ...gapFigures(runs, detail), ...ledgerGaps(runs, detail)];
}
