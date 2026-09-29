/**
 * What one stored artifact says: the per-run figures, derived from a report the report validator
 * already admitted or from an evaluation runner's fixture outcome.
 *
 * This module is pure and takes artifacts that are already parsed, so the reading, the derivation, and
 * the across-run aggregation stay separable. It never reads a model answer as accuracy: a question no
 * request asked is counted as not asked rather than as a correct negative, and a returned probability
 * is carried only as the number the artifact stored.
 */

import { type SemanticScopeExclusion } from '../semanticReview/contracts.ts';
import { type SemanticReport } from '../semanticReview/report.ts';
import {
    BUDGET_STOPPED_REASON,
    buildScopeStates,
    DEADLINE_STOPPED_REASON,
    DRY_RUN_REASON,
    MISSING_REQUIRED_EVIDENCE_REASON,
} from '../semanticReview/scopeAccounting.ts';

import {
    countBy,
    emptyNotAskedReasons,
    emptyScopeStates,
    mergeCounts,
    sortedCounts,
    type EvidenceCompleteness,
    type EvaluationFixtureOutcome,
    type FindingOutcome,
    type MeasurementArtifact,
    type MeasurementRun,
    type OutcomeAccounting,
    type RecordExtras,
    type RecordedSignalDisposition,
    type ReviewRoundSummary,
    type RuleCoverage,
    type RuleNotAskedReason,
    type RunUsage,
    type RunWallClock,
    type SignalOutcome,
    type StoredDossier,
} from './contracts.ts';

import type { ReviewDossier } from '../reviewDossier.ts';

/** One (unit, rule) pair the run's plan held, and whether a request asked it. */
type RulePair = {
    readonly path: string;
    readonly ruleId: string;
    readonly asked: boolean;
    readonly reason?: RuleNotAskedReason;
};

export function isScanReport(report: SemanticReport): report is Extract<SemanticReport, { mode: 'scan' }> {
    return report.mode === 'scan';
}

/**
 * The not-asked reason one omission state names. This is the same four-way split
 * `SemanticScopeStates` makes in `unassessedState`, read here per path so a rule's reason can be
 * reported without the totals; the two must name a unit's omission the same way.
 */
function notAskedReasonForOmission(reason: string | undefined, label: string): RuleNotAskedReason {
    if (reason === MISSING_REQUIRED_EVIDENCE_REASON) {
        return 'no-answerable-question';
    }
    if (
        reason === BUDGET_STOPPED_REASON ||
        reason === DEADLINE_STOPPED_REASON ||
        // The unit a run-level stop landed on carries the stop's own code, while the units behind it
        // carry the admission reason, and both name the same omission.
        reason === 'budget_exhausted' ||
        reason === 'deadline_elapsed'
    ) {
        return 'omitted-for-budget-or-deadline';
    }
    if (reason === DRY_RUN_REASON || reason === 'dry-run') {
        return 'dry-run';
    }
    if (reason === undefined) {
        // The report validator admits no such shape: a planned unit is either signalled or recorded
        // unassessed, so a stored report that reached here was not read through the validator.
        throw new Error(
            `${label} is neither signalled nor recorded unassessed; the report validator admits no such plan`
        );
    }
    return 'provider-failure';
}

/**
 * Every (unit, rule) pair the report's own ledgers hold, and why each unasked one was not asked.
 *
 * A signal is the report's ledger of one pair; a plan entry is the only other place a pair appears, and
 * it is the only place a unit omitted before admission publishes its rule set. The per-run coverage
 * counts and the record-level rule vocabulary are both read from this one list, so they cannot
 * disagree about which rule went unasked.
 */
function rulePairs(report: SemanticReport): RulePair[] {
    if (!isScanReport(report)) {
        throw new Error('rule coverage is read from a scan report; a verify report assesses findings');
    }
    const omissionByPath = new Map(report.scope.unassessed.map((entry) => [entry.path, entry.reason]));
    const pairs = new Map<string, RulePair>();
    for (const signal of report.signals) {
        const asked = signal.missingEvidence.length === 0;
        pairs.set(`${signal.path}\u0000${signal.ruleId}`, {
            path: signal.path,
            ruleId: signal.ruleId,
            asked,
            reason: unaskedReason(asked, omissionByPath.get(signal.path)),
        });
    }
    for (const entry of report.scope.requestOrder ?? []) {
        for (const ruleId of entry.ruleIds) {
            const key = `${entry.path}\u0000${ruleId}`;
            if (pairs.has(key)) {
                continue;
            }
            pairs.set(key, {
                path: entry.path,
                ruleId,
                asked: false,
                reason: notAskedReasonForOmission(omissionByPath.get(entry.path), `planned unit ${entry.path}`),
            });
        }
    }
    return [...pairs.values()];
}

/**
 * Why one signal's rule was not asked: a unit no pass could carry evidence for is reported as having
 * no answerable question, and any other unasked rule is one whose own required evidence was missing.
 */
function unaskedReason(asked: boolean, omissionReason: string | undefined): RuleNotAskedReason | undefined {
    if (asked) {
        return undefined;
    }
    return omissionReason === MISSING_REQUIRED_EVIDENCE_REASON ? 'no-answerable-question' : 'missing-required-evidence';
}

/** Reads one scan's rule coverage from the ledger the report itself publishes. */
export function scanRuleCoverage(report: SemanticReport): RuleCoverage {
    const pairs = rulePairs(report);
    const notAskedByReason = emptyNotAskedReasons();
    for (const pair of pairs) {
        if (pair.reason !== undefined) {
            notAskedByReason[pair.reason] += 1;
        }
    }
    const asked = pairs.filter((pair) => pair.asked).length;
    const planned = report.scope.requestOrder;
    return {
        applicableRules: pairs.length,
        applicableRulesComplete: planned !== undefined,
        unitsWithUnpublishedRuleSets: planned === undefined ? report.scope.unassessed.length : 0,
        askedRules: asked,
        notAskedRules: pairs.length - asked,
        notAskedByReason,
    };
}

/** The evidence a run could not send: what its signals report missing, and what it truncated. */
export function evidenceCompleteness(report: SemanticReport): EvidenceCompleteness {
    const tokens: Record<string, number> = {};
    const units = new Set<string>();
    if (isScanReport(report)) {
        for (const signal of report.signals) {
            if (signal.missingEvidence.length === 0) {
                continue;
            }
            units.add(signal.path);
            for (const token of signal.missingEvidence) {
                tokens[token] = (tokens[token] ?? 0) + 1;
            }
        }
    } else {
        // A verifier records a finding it could not decide as `needs_more_evidence`, which covers both
        // evidence that never arrived and an assessment that stayed undecided; the report itself does
        // not separate them, so neither does this token.
        for (const assessment of report.findingAssessments) {
            if (assessment.disposition !== 'needs_more_evidence') {
                continue;
            }
            units.add(assessment.findingId);
            const token = 'finding evidence not supplied or not decisive';
            tokens[token] = (tokens[token] ?? 0) + 1;
        }
    }
    return {
        unitsMissingRequiredEvidence: units.size,
        requiredEvidenceTokensMissing: sortedCounts(tokens),
        truncatedRegions: report.scope.truncated.length,
        truncatedPaths: new Set(report.scope.truncated.map((entry) => entry.path)).size,
        truncationReasons: countBy(report.scope.truncated, (entry: SemanticScopeExclusion) => entry.reason),
        limitationCount: report.limitations.length,
    };
}

/** The run's own omission totals, published and re-derived from the entries behind them. */
export function outcomeAccounting(report: SemanticReport): OutcomeAccounting {
    return {
        publishedStates: report.scope.states ?? null,
        derivedFromEntries: buildScopeStates({
            excluded: report.scope.excluded,
            unassessed: report.scope.unassessed,
        }),
        unassessedReasons: countBy(report.scope.unassessed, (entry) => entry.reason),
        excludedReasons: countBy(report.scope.excluded, (entry) => entry.reason),
    };
}

/** Every string anywhere in a stored dossier, which is where a literal signal citation disposes. */
function dossierStrings(value: unknown, into: string[]): void {
    if (typeof value === 'string') {
        into.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            dossierStrings(entry, into);
        }
        return;
    }
    if (typeof value === 'object' && value !== null) {
        for (const entry of Object.values(value)) {
            dossierStrings(entry, into);
        }
    }
}

/**
 * Whether a round disposed of one fired signal: a typed `signalDispositions` entry naming its exact
 * rule and path, or the literal citation token ADR 0050 also accepts. The token is matched literally;
 * the rule that a longer citation containing it disposes of the longer signal instead is the
 * publication gate's, and a dossier that recorded only prose stays undismissed here rather than being
 * guessed at.
 */
export function dossierDisposesOf(dossier: ReviewDossier, ruleId: string, path: string): boolean {
    const typed = dossier.signalDispositions?.some((entry) => entry.ruleId === ruleId && entry.path === path);
    if (typed === true) {
        return true;
    }
    const texts: string[] = [];
    dossierStrings(dossier, texts);
    const token = `semantic-signal ${ruleId} ${path}`;
    return texts.some((text) => text.includes(token));
}

function recordedDispositions(dossier: StoredDossier): RecordedSignalDisposition[] {
    return (dossier.dossier.signalDispositions ?? []).map((entry) => ({
        ruleId: entry.ruleId,
        path: entry.path,
        disposition: entry.disposition,
        artifact: entry.artifact ?? null,
        dossier: dossier.path,
    }));
}

export function reviewRoundSummary(stored: StoredDossier): ReviewRoundSummary {
    const events = stored.dossier.events;
    const countKind = (kind: string): number => events.filter((event) => event.kind === kind).length;
    return {
        path: stored.path,
        pr: stored.dossier.pr,
        headSha: stored.dossier.headSha,
        stanceDraws: countKind('stance-completed'),
        stanceOutcomes: countBy(
            events.filter((event) => event.kind === 'stance-completed'),
            (event) => ('outcome' in event ? event.outcome : undefined)
        ),
        findingsAccepted: countKind('finding-accepted'),
        findingsDiscarded: countKind('finding-discarded'),
        findingsPublished: countKind('finding-published'),
        reviewsPublished: countKind('review-published'),
        reassessments: countKind('review-reassessed'),
        recommendation: stored.dossier.recommendation,
        assessmentImpact: stored.dossier.assessmentImpact ?? null,
        dispositionsRecorded: stored.dossier.signalDispositions !== undefined,
    };
}

/** The dossiers recorded for one head, which is the head a run's signals belong to. */
function dossiersForRun(
    prNumber: number | null,
    headSha: string | null,
    dossiers: readonly StoredDossier[]
): StoredDossier[] {
    if (headSha === null) {
        return [];
    }
    return dossiers.filter(
        (stored) => stored.dossier.headSha === headSha && (prNumber === null || stored.dossier.pr === prNumber)
    );
}

export function signalOutcome(report: SemanticReport, dossiers: readonly StoredDossier[]): SignalOutcome {
    if (!isScanReport(report)) {
        throw new Error('a signal ledger is read from a scan report; a verify report assesses findings');
    }
    const fired = report.signals
        .filter((signal) => signal.disposition === 'recommend_investigation')
        .map((signal) => ({ ruleId: signal.ruleId, path: signal.path }));
    const matched = dossiersForRun(report.context.prNumber ?? null, report.context.headSha, dossiers);
    const dispositions = matched.flatMap((stored) => recordedDispositions(stored));
    const dismissed = fired.filter((signal) =>
        matched.some((stored) => dossierDisposesOf(stored.dossier, signal.ruleId, signal.path))
    );
    // A head with no dossier recorded nothing about its signals, so none of them is read as either
    // dismissed or undismissed; the count of what could not be told apart is kept on its own.
    const withDossier = matched.length > 0;
    const isDismissed = (signal: (typeof fired)[number]): boolean =>
        dismissed.some((entry) => entry.ruleId === signal.ruleId && entry.path === signal.path);
    const undismissed = withDossier ? fired.filter((signal) => !isDismissed(signal)) : [];
    return {
        totalSignals: report.signals.length,
        byDisposition: countBy(report.signals, (signal) => signal.disposition),
        firedSignals: fired,
        dossiersMatched: matched.map((stored) => stored.path),
        dispositionsRecorded: dispositions,
        dismissedFiredSignals: dismissed.length,
        undismissedFiredSignals: undismissed,
        firedSignalsWithoutDossier: withDossier ? 0 : fired.length,
    };
}

export function findingOutcome(report: SemanticReport): FindingOutcome {
    if (isScanReport(report)) {
        throw new Error('a finding ledger is read from a verify report; a scan report assesses units');
    }
    return {
        totalAssessments: report.findingAssessments.length,
        byDisposition: countBy(report.findingAssessments, (assessment) => assessment.disposition),
        escalated: report.findingAssessments.filter((assessment) => assessment.escalate).length,
    };
}

function usageOf(report: SemanticReport): RunUsage {
    return { ...report.usage, cacheHits: report.scope.cacheHits };
}

/** The run's own span, read from the two timestamps it wrote. A span is never inferred from anything else. */
export function wallClockOf(report: SemanticReport): RunWallClock | null {
    const started = Date.parse(report.startedAt);
    const completed = Date.parse(report.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed)) {
        return null;
    }
    return { startedAt: report.startedAt, completedAt: report.completedAt, durationMs: completed - started };
}

export function aggregateStoredReport(input: {
    readonly artifact: MeasurementArtifact;
    readonly report: SemanticReport;
    readonly dossiers: readonly StoredDossier[];
}): MeasurementRun {
    const { report } = input;
    const scan = isScanReport(report);
    return {
        artifact: input.artifact,
        runId: report.runId,
        mode: report.mode,
        execution: report.execution,
        failureCode: report.failureCode ?? null,
        context: {
            repository: report.context.repository,
            prNumber: report.context.prNumber ?? null,
            headSha: report.context.headSha,
            mergeBaseSha: report.context.mergeBaseSha,
            evidenceProfile: report.context.evidenceProfile,
        },
        models: { requested: report.requestedModel, returned: [...report.returnedModels] },
        wallClock: wallClockOf(report),
        usage: usageOf(report),
        ruleCoverage: scan ? scanRuleCoverage(report) : null,
        evidenceCompleteness: evidenceCompleteness(report),
        outcomeAccounting: outcomeAccounting(report),
        signalOutcome: scan ? signalOutcome(report, input.dossiers) : null,
        findingOutcome: scan ? null : findingOutcome(report),
        reviewRounds: dossiersForRun(report.context.prNumber ?? null, report.context.headSha, input.dossiers).map(
            reviewRoundSummary
        ),
        labelledExpectationHeld: null,
    };
}

export function aggregateEvaluationFixture(input: {
    readonly artifact: MeasurementArtifact;
    readonly fixture: EvaluationFixtureOutcome;
}): MeasurementRun {
    const { fixture } = input;
    const notAskedByReason = emptyNotAskedReasons();
    const tokens: Record<string, number> = {};
    for (const entry of fixture.rulesNotAsked) {
        const reason: RuleNotAskedReason =
            entry.missingEvidence.length === 0 ? 'no-answerable-question' : 'missing-required-evidence';
        notAskedByReason[reason] += 1;
        for (const token of entry.missingEvidence) {
            tokens[token] = (tokens[token] ?? 0) + 1;
        }
    }
    const fired = fixture.outcomes
        .filter((outcome) => outcome.disposition === 'recommend_investigation')
        .map((outcome) => ({ ruleId: outcome.ruleId, path: fixture.path }));
    return {
        artifact: input.artifact,
        runId: fixture.fixtureId,
        mode: 'scan',
        execution: fixture.execution,
        failureCode: fixture.failureCode ?? null,
        // The outcome file records what a fixture asked and what came back; it carries no revision
        // context, so nothing here names a repository, a head, or a pull request.
        context: { repository: null, prNumber: null, headSha: null, mergeBaseSha: null, evidenceProfile: null },
        models: { requested: fixture.requestedModel, returned: [...fixture.returnedModels] },
        wallClock: null,
        usage: { ...fixture.usage, cacheHits: 0 },
        ruleCoverage: {
            applicableRules: fixture.rulesAsked.length + fixture.rulesNotAsked.length,
            applicableRulesComplete: true,
            unitsWithUnpublishedRuleSets: 0,
            askedRules: fixture.rulesAsked.length,
            notAskedRules: fixture.rulesNotAsked.length,
            notAskedByReason,
        },
        evidenceCompleteness: {
            unitsMissingRequiredEvidence: fixture.rulesNotAsked.length > 0 ? 1 : 0,
            requiredEvidenceTokensMissing: sortedCounts(tokens),
            // A fixture outcome reports the rules it asked and the evidence it carried; it carries no
            // truncation ledger, so nothing recorded whether evidence was cut.
            truncatedRegions: null,
            truncatedPaths: null,
            truncationReasons: null,
            limitationCount: fixture.limitations.length,
        },
        outcomeAccounting: {
            publishedStates: null,
            derivedFromEntries: emptyScopeStates(),
            unassessedReasons: {},
            excludedReasons: {},
        },
        signalOutcome: {
            totalSignals: fixture.outcomes.length,
            byDisposition: countBy(fixture.outcomes, (outcome) => outcome.disposition),
            firedSignals: fired,
            dossiersMatched: [],
            dispositionsRecorded: [],
            dismissedFiredSignals: 0,
            undismissedFiredSignals: [],
            firedSignalsWithoutDossier: fired.length,
        },
        findingOutcome: null,
        reviewRounds: [],
        labelledExpectationHeld: fixture.expectedConcernHeld,
    };
}

export function emptyRecordExtras(): RecordExtras {
    return { notAskedByRule: {}, signalsByRule: {}, limitationsByText: {} };
}

/** Folds one report's rule and limitation vocabularies into the set-wide ones. */
export function addReportExtras(extras: RecordExtras, report: SemanticReport): RecordExtras {
    if (!isScanReport(report)) {
        return {
            notAskedByRule: extras.notAskedByRule,
            signalsByRule: extras.signalsByRule,
            limitationsByText: mergeCounts(
                extras.limitationsByText,
                countBy(report.limitations, (text) => text)
            ),
        };
    }
    return {
        notAskedByRule: mergeCounts(extras.notAskedByRule, notAskedCounts(report)),
        signalsByRule: mergeCounts(
            extras.signalsByRule,
            countBy(report.signals, (signal) => signal.ruleId)
        ),
        limitationsByText: mergeCounts(
            extras.limitationsByText,
            countBy(report.limitations, (text) => text)
        ),
    };
}

/** Which rules no request asked, counted by rule, read from the same pairs the coverage figures count. */
function notAskedCounts(report: SemanticReport): Record<string, number> {
    return countBy(
        rulePairs(report).filter((pair) => !pair.asked),
        (pair) => pair.ruleId
    );
}
