/**
 * The measurement record, over small synthetic sidecars and dossiers.
 *
 * Every fixture is written to a temporary checkout and read back through the real readers — the report
 * validator for a sidecar, the dossier reader for a dossier — so a fixture that only looked like a
 * stored artifact cannot pass here. The cases pin the aggregates the record publishes, the separation
 * of the omission states, the repeated-warning count, and the two readings this record refuses to
 * make: a malformed artifact is never a silent zero, and a figure no artifact carries is reported as
 * not computable rather than as a count of none.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { parseReviewDossier, type DossierPayload, type ReviewDossierSignalDisposition } from '../reviewDossier.ts';
import { buildDossier, serializeReviewDossier } from '../reviewDossierChain.ts';
import {
    SEMANTIC_REPORT_FORMAT,
    computeContextDigest,
    type SemanticRevisionInputs,
    type UnitPriorityClass,
} from '../semanticReview/contracts.ts';
import { parseReportJson } from '../semanticReview/report.ts';
import {
    isSemanticRuleId,
    semanticRule,
    SEVERE_INVESTIGATION_CATEGORIES,
    type RuleInvestigationCategory,
} from '../semanticReview/rules.ts';
import { buildScopeStates, type SemanticScopeStates } from '../semanticReview/scopeAccounting.ts';
import { measureCheckout, parseCommandLine, renderMeasurementSummary } from '../semanticReviewMeasurement.ts';
import { snapshotImportSpecifiers } from '../trustedGithubWriteBootstrap.ts';

import type {
    MeasurementDetail,
    MeasurementMachine,
    MeasurementRecord,
} from '../semanticReviewMeasurement/contracts.ts';

const MACHINE: MeasurementMachine = {
    checkoutGitSha: 'f'.repeat(40),
    workingTree: 'clean',
    host: { platform: 'darwin', release: '25.5.0', arch: 'arm64', cores: 12 },
    loadAverage1m: 0.5,
};

const MEASURED_AT = '2026-09-29T12:00:00.000Z';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function checkout(): string {
    const root = mkdtempSync(join(tmpdir(), 'semantic-measurement-'));
    roots.push(root);
    return root;
}

type SignalFixture = {
    readonly path: string;
    readonly ruleId: string;
    readonly disposition: 'recommend_investigation' | 'no_additional_recommendation';
    readonly missingEvidence?: readonly string[];
};

type OmissionFixture = { readonly path: string; readonly reason: string };

type ScanFixtureInput = {
    readonly headSha: string;
    readonly prNumber?: number;
    readonly signals: readonly SignalFixture[];
    readonly unassessed?: readonly OmissionFixture[];
    readonly excluded?: readonly OmissionFixture[];
    readonly truncated?: readonly OmissionFixture[];
    readonly requestOrder?: readonly { readonly path: string; readonly ruleIds: readonly string[] }[];
    readonly limitations?: readonly string[];
    readonly cacheHits?: number;
    readonly startedAt?: string;
    readonly completedAt?: string;
    /** Forcing the state is how a case pins an unavailable or cancelled run the fixture cannot derive. */
    readonly execution?: string;
    readonly failureCode?: string;
};

function revisionInputs(prNumber: number | undefined, headSha: string): SemanticRevisionInputs {
    return {
        repository: 'acme/sourdaw',
        repositoryId: 'R_acme',
        prNumber,
        headSha,
        targetBaseSha: 'b'.repeat(40),
        mergeBaseSha: 'c'.repeat(40),
        trustedExecutionSha: 'd'.repeat(40),
        contractSourceSha: 'e'.repeat(40),
        evidenceProfile: 'ci',
        rulesDigest: 'a'.repeat(64),
        policyVersion: 'semantic-policy-v1',
    };
}

function contextFor(prNumber: number | undefined, headSha: string) {
    const inputs = revisionInputs(prNumber, headSha);
    return { ...inputs, contextDigest: computeContextDigest(inputs) };
}

/** A fixture's optional list, as a fresh array: an absent list and an empty one are the same here. */
function listOf<TItem>(items: readonly TItem[] | undefined): TItem[] {
    return items === undefined ? [] : [...items];
}

function signalRecord(fixture: SignalFixture): unknown {
    const missing = listOf(fixture.missingEvidence);
    const recommend = fixture.disposition === 'recommend_investigation';
    return {
        ruleId: fixture.ruleId,
        unitId: fixture.path,
        path: fixture.path,
        outcome: signalOutcomeFor(missing.length, recommend),
        probability: recommend ? 0.9 : 0.1,
        confidence: 0,
        disposition: fixture.disposition,
        // A real signal carries the rule's own category, and the plan's class re-derives severity from
        // it, so the fixture reads the same table the producer does rather than inventing one.
        investigationCategory: categoryOf(fixture.ruleId),
        missingEvidence: missing,
        reasoning: 'fixture',
    };
}

/** The escalation categories, read as a set so a rule's category joins by membership, never by a cast. */
const SEVERE_CATEGORIES: ReadonlySet<string> = new Set(SEVERE_INVESTIGATION_CATEGORIES);

/** The investigation category of one rule, from the trusted table, so a fixture cannot invent one. */
function categoryOf(ruleId: string): RuleInvestigationCategory {
    if (!isSemanticRuleId(ruleId)) {
        throw new Error(`fixture rule id ${ruleId} is not a known semantic rule`);
    }
    return semanticRule(ruleId).investigationCategory;
}

/**
 * The class the producer would place one planned unit in, read from the rules the entry publishes: a
 * severe rule's category is what makes a unit severe, and the fixture's paths are production material.
 */
function fixturePriorityClass(ruleIds: readonly string[]): UnitPriorityClass {
    return ruleIds.some((ruleId) => SEVERE_CATEGORIES.has(categoryOf(ruleId))) ? 'severe-production' : 'production';
}

/**
 * The answerable count the producer would publish for one planned entry: the rules whose best pass
 * carries all their required evidence, which is what a signal without missing evidence records. An entry
 * no signal names was omitted before any request, so the fixture leaves every rule of it answerable.
 */
function fixtureAnswerableRules(input: {
    readonly ruleIds: readonly string[];
    readonly signalled: boolean;
    readonly cleanSignals: number;
}): number {
    if (!input.signalled) {
        return input.ruleIds.length;
    }
    return input.cleanSignals;
}

/** The band the validator's own interpretation would reach: withheld evidence outranks any answer. */
function signalOutcomeFor(missingCount: number, recommend: boolean): string {
    if (missingCount > 0) {
        return 'insufficient_context';
    }
    return recommend ? 'signal' : 'no_signal';
}

/** A scan report that the shipped validator admits, so a broken fixture fails here rather than as a skip. */
function scanFixture(input: ScanFixtureInput): unknown {
    const context = contextFor(input.prNumber, input.headSha);
    const unassessed = listOf(input.unassessed);
    const excluded = listOf(input.excluded);
    const truncated = listOf(input.truncated);
    const omittedPaths = new Set(unassessed.map((entry) => entry.path));
    const assessed = new Set(input.signals.map((signal) => signal.path).filter((path) => !omittedPaths.has(path))).size;
    const eligible = input.requestOrder === undefined ? assessed + unassessed.length : input.requestOrder.length;
    const scope: Record<string, unknown> = {
        discovered: eligible + excluded.length,
        eligible,
        assessed,
        cacheHits: input.cacheHits ?? 0,
        excluded,
        unassessed,
        truncated,
        states: buildScopeStates({ excluded, unassessed }),
    };
    // A planned unit's rule set is published only when the report carries an order; the fixture adds
    // the field only then, so a report without one is the older shape rather than an empty order.
    if (input.requestOrder !== undefined) {
        const signalledPaths = new Set(input.signals.map((signal) => signal.path));
        const cleanSignals = new Map<string, number>();
        for (const signal of input.signals) {
            if (listOf(signal.missingEvidence).length > 0) {
                continue;
            }
            cleanSignals.set(signal.path, (cleanSignals.get(signal.path) ?? 0) + 1);
        }
        scope.requestOrder = input.requestOrder.map((entry) => ({
            path: entry.path,
            priorityClass: fixturePriorityClass(entry.ruleIds),
            missingRequiredEvidenceTokens: 0,
            answerableRules: fixtureAnswerableRules({
                ruleIds: entry.ruleIds,
                signalled: signalledPaths.has(entry.path),
                cleanSignals: cleanSignals.get(entry.path) ?? 0,
            }),
            ruleIds: [...entry.ruleIds],
        }));
    }
    const report: Record<string, unknown> = {
        schemaVersion: SEMANTIC_REPORT_FORMAT,
        mode: 'scan',
        runId: `run-${input.headSha.slice(0, 8)}`,
        context,
        requestedModel: 'jev-1.13.0',
        returnedModels: ['jev-1.13.0'],
        sdkVersion: 'typesafe-sdk-1',
        rulesDigest: context.rulesDigest,
        policyDigest: '9'.repeat(64),
        policyVersion: context.policyVersion,
        startedAt: input.startedAt ?? '2026-09-20T10:00:00.000Z',
        completedAt: input.completedAt ?? '2026-09-20T10:00:05.000Z',
        // Truncated evidence or an omission means the scope was not fully assessed, which `completed`
        // cannot claim; the fixture derives the state the way the run's own decision does.
        execution: input.execution ?? (truncated.length > 0 || unassessed.length > 0 ? 'partial' : 'completed'),
        scope,
        limitations: listOf(input.limitations),
        usage: {
            networkAttempts: 2,
            logicalRequests: 2,
            retries: 1,
            submittedBytes: 4096,
            actualInputTokens: 1024,
            estimatedInputTokens: 900,
            attemptsWithUnknownUsage: 0,
            estimatedCostUsd: 0.001234,
            pricingConfigurationVersion: 'typesafe-pricing-2026-09-20',
        },
        publication: { state: 'not_requested' },
        signals: input.signals.map(signalRecord),
    };
    if (input.failureCode !== undefined) {
        report.failureCode = input.failureCode;
    }
    return report;
}

/** A verification report the shipped validator admits, for a head a scan and a verify both cover. */
function verificationFixture(headSha: string, prNumber?: number): unknown {
    return {
        schemaVersion: SEMANTIC_REPORT_FORMAT,
        mode: 'verify',
        runId: `verify-${headSha.slice(0, 8)}`,
        context: contextFor(prNumber, headSha),
        requestedModel: 'jev-1.13.0',
        returnedModels: ['jev-1.13.0'],
        sdkVersion: 'typesafe-sdk-1',
        rulesDigest: 'a'.repeat(64),
        policyDigest: '9'.repeat(64),
        policyVersion: 'semantic-policy-v1',
        startedAt: '2026-09-20T10:00:00.000Z',
        completedAt: '2026-09-20T10:00:02.000Z',
        execution: 'completed',
        scope: {
            discovered: 1,
            eligible: 1,
            assessed: 1,
            cacheHits: 0,
            excluded: [],
            unassessed: [],
            truncated: [],
        },
        limitations: [],
        usage: {
            networkAttempts: 1,
            logicalRequests: 1,
            retries: 0,
            submittedBytes: 512,
            actualInputTokens: 128,
            estimatedInputTokens: 100,
            attemptsWithUnknownUsage: 0,
            estimatedCostUsd: 0.0001,
            pricingConfigurationVersion: 'typesafe-pricing-2026-09-20',
        },
        publication: { state: 'not_requested' },
        findingAssessments: [
            {
                findingId: 'F1',
                support: {
                    outcome: 'supported',
                    probabilities: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                    confidence: 0.9,
                },
                attribution: {
                    outcome: 'introduced_by_change',
                    probabilities: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                    confidence: 0.9,
                },
                kind: {
                    outcome: 'behavioral_or_contract_issue',
                    probabilities: {
                        behavioral_or_contract_issue: 0.9,
                        style_preference: 0.05,
                        undetermined: 0.05,
                    },
                    confidence: 0.9,
                },
                disposition: 'ready_for_orchestrator_validation',
                escalate: false,
                strongestEvidenceIds: ['E1'],
                reasoning: 'fixture',
            },
        ],
    };
}

/**
 * One evaluation runner result, as the runner writes it. A case overrides the fields it is about, so a
 * fixture that disagrees with itself can be written down.
 */
function evaluationOutcome(overrides: Record<string, unknown> = {}): unknown {
    const fixture: Record<string, unknown> = {
        fixtureId: 'fixture-1',
        kind: 'revision',
        path: 'src/a.ts',
        ruleId: 'assertion_deleted',
        sourceKind: 'corpus-fixture',
        execution: 'completed',
        requestedModel: 'jev-1.13.0',
        returnedModels: ['jev-1.13.0'],
        rulesAsked: ['assertion_deleted'],
        rulesNotAsked: [{ ruleId: 'timing_semantics_changed', missingEvidence: ['scheduling call-site'] }],
        evidenceSupplied: ['E1'],
        missingEvidenceByRule: { timing_semantics_changed: ['scheduling call-site'] },
        outcomes: [
            {
                ruleId: 'assertion_deleted',
                outcome: 'signal',
                probability: 0.93,
                disposition: 'recommend_investigation',
                reasoning: 'fixture',
            },
        ],
        expectedConcernHeld: true,
        otherSignals: [],
        providerRequests: 1,
        usage: {
            networkAttempts: 1,
            logicalRequests: 1,
            retries: 0,
            submittedBytes: 2048,
            actualInputTokens: 512,
            estimatedInputTokens: 500,
            attemptsWithUnknownUsage: 0,
            estimatedCostUsd: 0.0004,
            pricingConfigurationVersion: 'typesafe-pricing-2026-09-20',
        },
        limitations: [],
    };
    for (const [key, value] of Object.entries(overrides)) {
        fixture[key] = value;
    }
    return { outcomes: [fixture], providerRequests: 1, signals: 1, expectationsHeld: 1 };
}

function writeSidecar(root: string, digest: string, report: unknown, name = 'scan.json'): void {
    parseReportJson(JSON.stringify(report), `fixture ${digest}/${name}`);
    const directory = join(root, '.agents', 'semantic-review', digest);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), `${JSON.stringify(report, null, 4)}\n`);
}

function writeRawSidecar(root: string, digest: string, text: string, name = 'scan.json'): void {
    const directory = join(root, '.agents', 'semantic-review', digest);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), text);
}

function dossierFixture(input: {
    readonly pr: number;
    readonly headSha: string;
    readonly dispositions?: readonly ReviewDossierSignalDisposition[];
    readonly limitation?: string;
    readonly findingsAccepted?: number;
}): unknown {
    const events: DossierPayload['events'] = [
        {
            kind: 'stance-completed',
            stance: 'a stance',
            reviewerModel: 'reviewer-model',
            modelTier: 'standard',
            outcome: 'clean',
        },
    ];
    for (let index = 0; index < (input.findingsAccepted ?? 0); index += 1) {
        events.push({
            kind: 'finding-accepted',
            findingId: `finding ${String(index)}`,
            path: 'src/a.ts',
            line: 1,
            side: 'RIGHT',
        });
    }
    const payload: DossierPayload = {
        pr: input.pr,
        headSha: input.headSha,
        baseSha: 'b'.repeat(40),
        riskClasses: ['ordinary'],
        requiredStances: ['a stance'],
        events,
        evidence: [],
        limitations: input.limitation === undefined ? [] : [input.limitation],
        recommendation: 'approve',
        assessmentImpact: 'none',
    };
    if (input.dispositions !== undefined) {
        payload.signalDispositions = [...input.dispositions];
    }
    const dossier = buildDossier(payload);
    // Round-tripped through the serialized bytes the caller's own record is written as, so the fixture
    // is what a reader finds on disk rather than the object the builder returned.
    return JSON.parse(serializeReviewDossier(dossier)) as unknown;
}

function writeDossier(root: string, name: string, dossier: unknown): void {
    parseReviewDossier(dossier);
    const directory = join(root, '.agents', 'review-bundles', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'dossier.json'), `${JSON.stringify(dossier, null, 4)}\n`);
}

function measure(
    root: string,
    overrides: { evaluationPath?: string; strict?: boolean; detail?: MeasurementDetail } = {}
): MeasurementRecord {
    return measureCheckout({
        root,
        evaluationOutcomePath: overrides.evaluationPath ?? null,
        strict: overrides.strict ?? false,
        // The per-run figures are what most cases read, so they measure at the full detail level; the
        // aggregate default has cases of its own.
        detail: overrides.detail ?? 'runs',
        measuredAt: MEASURED_AT,
        machine: MACHINE,
    });
}

const HEAD_ONE = '1'.repeat(40);
const HEAD_TWO = '2'.repeat(40);

/**
 * One scan holding every omission state at once: an assessed unit with an answered and an unasked rule,
 * a unit a spent budget stopped, a unit the provider refused, and a unit no pass could ask.
 */
function everyOmissionState(headSha: string, prNumber?: number): unknown {
    return scanFixture({
        headSha,
        prNumber,
        signals: [
            { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' },
            {
                path: 'src/a.ts',
                ruleId: 'stated_invariant_contradicted',
                disposition: 'no_additional_recommendation',
                missingEvidence: ['after source'],
            },
            {
                path: 'src/d.ts',
                ruleId: 'duplicates_existing_mechanism',
                disposition: 'no_additional_recommendation',
                missingEvidence: ['caller or contract'],
            },
        ],
        unassessed: [
            { path: 'src/b.ts', reason: 'budget-exhausted-before-admission' },
            { path: 'src/c.ts', reason: 'invalid_response' },
            { path: 'src/d.ts', reason: 'missing-required-evidence' },
        ],
        excluded: [
            { path: 'docs/x.md', reason: 'no-applicable-rule' },
            { path: 'src/secret.ts', reason: 'evidence-withheld' },
        ],
        truncated: [{ path: 'src/a.ts', reason: 'unit-evidence-reduced-below-request-budget' }],
        requestOrder: [
            { path: 'src/a.ts', ruleIds: ['assertion_deleted', 'stated_invariant_contradicted'] },
            { path: 'src/b.ts', ruleIds: ['audio_thread_allocation'] },
            { path: 'src/c.ts', ruleIds: ['timing_semantics_changed'] },
            { path: 'src/d.ts', ruleIds: ['duplicates_existing_mechanism'] },
        ],
        limitations: ['evidence for src/a.ts did not fit the per-request state budget: 2 region(s) were not sent'],
        cacheHits: 1,
    });
}

describe('rule coverage', () => {
    it('counts the rules applicable, asked, and not asked, each with the reason it was not asked', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const coverage = measure(root).runs[0]?.ruleCoverage;

        expect(coverage).not.toBeNull();
        expect(coverage?.applicableRules).toBe(5);
        expect(coverage?.applicableRulesComplete).toBe(true);
        expect(coverage?.askedRules).toBe(1);
        expect(coverage?.notAskedRules).toBe(4);
        expect(coverage?.notAskedByReason).toEqual({
            'missing-required-evidence': 1,
            'no-answerable-question': 1,
            'omitted-for-budget-or-deadline': 1,
            'provider-failure': 1,
            'dry-run': 0,
        });
    });

    it('names which rules went unasked rather than only how many', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        expect(measure(root).acrossRuns.ruleCoverage.notAskedByRule).toEqual({
            audio_thread_allocation: 1,
            duplicates_existing_mechanism: 1,
            stated_invariant_contradicted: 1,
            timing_semantics_changed: 1,
        });
    });

    it('reports the applicable count as a floor, and says so, when the report publishes no planned order', () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [
                    { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' },
                ],
                unassessed: [{ path: 'src/b.ts', reason: 'budget-exhausted-before-admission' }],
            })
        );

        const record = measure(root);

        expect(record.runs[0]?.ruleCoverage?.applicableRulesComplete).toBe(false);
        expect(record.runs[0]?.ruleCoverage?.unitsWithUnpublishedRuleSets).toBe(1);
        expect(record.acrossRuns.ruleCoverage.applicableRulesCompleteEverywhere).toBe(false);
        expect(record.notComputable.map((entry) => entry.figure)).toContain('runs[].ruleCoverage.applicableRules');
    });

    it('records no rule coverage for a verification run and names the figure not computable', () => {
        const root = checkout();
        writeSidecar(root, 'verif-1', verificationFixture(HEAD_ONE, 4801), 'verification.json');

        const record = measure(root);

        expect(record.runs[0]?.ruleCoverage).toBeNull();
        expect(record.runs[0]?.findingOutcome).toEqual({
            totalAssessments: 1,
            byDisposition: { ready_for_orchestrator_validation: 1 },
            escalated: 0,
        });
        expect(record.notComputable.map((entry) => entry.figure)).toContain(
            'runs[].ruleCoverage for verification runs'
        );
    });
});

describe('outcome accounting', () => {
    it('keeps the four omission states apart and the two exclusion states apart', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const accounting = measure(root).runs[0]?.outcomeAccounting;

        const expected: SemanticScopeStates = {
            notApplicable: 1,
            excludedWithAssessmentOwed: 1,
            missingRequiredEvidence: 1,
            omittedForBudgetOrDeadline: 1,
            providerFailure: 1,
            dryRun: 0,
        };
        expect(accounting?.publishedStates).toEqual(expected);
        expect(accounting?.derivedFromEntries).toEqual(expected);
        expect(accounting?.unassessedReasons).toEqual({
            'budget-exhausted-before-admission': 1,
            invalid_response: 1,
            'missing-required-evidence': 1,
        });
        expect(accounting?.excludedReasons).toEqual({ 'evidence-withheld': 1, 'no-applicable-rule': 1 });
    });

    it('counts a provider failure and a spent budget separately from missing evidence', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const states = measure(root).acrossRuns.derivedOutcomeStates;

        expect(states).toMatchObject({
            providerFailure: 1,
            omittedForBudgetOrDeadline: 1,
            missingRequiredEvidence: 1,
            dryRun: 0,
        });
    });
});

describe('evidence completeness', () => {
    it('counts the units whose required evidence was missing, the tokens, and the truncation reasons', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const completeness = measure(root).runs[0]?.evidenceCompleteness;

        expect(completeness?.unitsMissingRequiredEvidence).toBe(2);
        expect(completeness?.requiredEvidenceTokensMissing).toEqual({
            'after source': 1,
            'caller or contract': 1,
        });
        expect(completeness?.truncatedRegions).toBe(1);
        expect(completeness?.truncatedPaths).toBe(1);
        expect(completeness?.truncationReasons).toEqual({
            'unit-evidence-reduced-below-request-budget': 1,
        });
        expect(completeness?.limitationCount).toBe(1);
    });

    it('folds the distinct limitation texts into one set-wide list with the runs that recorded each', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        writeSidecar(root, 'scan-2', everyOmissionState(HEAD_TWO, 4801));

        expect(measure(root).acrossRuns.evidence.limitationsByText).toEqual({
            'evidence for src/a.ts did not fit the per-request state budget: 2 region(s) were not sent': 2,
        });
    });

    it('counts a limitation text once per run however often that run repeated it', () => {
        // The figure is the number of runs that recorded the text, not the number of occurrences: the
        // fixture path already dedups with a Set, and a report that repeats a limitation in one run is
        // still one run that recorded it.
        const root = checkout();
        const repeated = 'evidence for src/a.ts was not supplied: it exceeds the per-region budget';
        const signals = [
            { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' as const },
        ];
        writeSidecar(
            root,
            'scan-1',
            scanFixture({ headSha: HEAD_ONE, signals, limitations: [repeated, repeated, 'a second text'] })
        );
        writeSidecar(root, 'scan-2', scanFixture({ headSha: HEAD_TWO, signals, limitations: [repeated] }));

        expect(measure(root).acrossRuns.evidence.limitationsByText).toEqual({
            'a second text': 1,
            [repeated]: 2,
        });
    });
});

describe('usage, cost and wall clock', () => {
    it("carries the run's own usage block, its cache hits, and its own span in milliseconds", () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const run = measure(root).runs[0];

        expect(run?.usage).toMatchObject({
            networkAttempts: 2,
            logicalRequests: 2,
            retries: 1,
            submittedBytes: 4096,
            actualInputTokens: 1024,
            estimatedInputTokens: 900,
            estimatedCostUsd: 0.001234,
            pricingConfigurationVersion: 'typesafe-pricing-2026-09-20',
        });
        // Cache hits are the scope's figure, not the usage block's: the run reports two network
        // attempts and one cache hit, which only the scope distinguishes.
        expect(run?.usage.cacheHits).toBe(1);
        expect(run?.wallClock).toEqual({
            startedAt: '2026-09-20T10:00:00.000Z',
            completedAt: '2026-09-20T10:00:05.000Z',
            durationMs: 5000,
        });
        expect(run?.models).toEqual({ requested: 'jev-1.13.0', returned: ['jev-1.13.0'] });
    });

    it("sums the runs' own spans rather than estimating one for the set", () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        writeSidecar(
            root,
            'scan-2',
            scanFixture({
                headSha: HEAD_TWO,
                prNumber: 4801,
                signals: [
                    { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' },
                ],
                startedAt: '2026-09-20T11:00:00.000Z',
                completedAt: '2026-09-20T11:00:01.500Z',
            })
        );

        const record = measure(root);

        expect(record.acrossRuns.wallClockMs).toBe(6500);
        expect(record.acrossRuns.wallClockRuns).toBe(2);
        expect(record.acrossRuns.usage.networkAttempts).toBe(4);
        expect(record.acrossRuns.usage.submittedBytes).toBe(8192);
    });
});

describe('signal outcomes and review rounds', () => {
    it('reads the typed disposition a round recorded for a fired signal', () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [{ path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'recommend_investigation' }],
            })
        );
        writeDossier(
            root,
            '4801-111111111111',
            dossierFixture({
                pr: 4801,
                headSha: HEAD_ONE,
                findingsAccepted: 1,
                dispositions: [
                    { ruleId: 'assertion_deleted', path: 'src/a.ts', disposition: 'false-positive', artifact: '#4802' },
                ],
            })
        );

        const run = measure(root).runs[0];

        expect(run?.signalOutcome?.dispositionsRecorded).toEqual([
            {
                ruleId: 'assertion_deleted',
                path: 'src/a.ts',
                disposition: 'false-positive',
                artifact: '#4802',
                dossier: join(root, '.agents', 'review-bundles', '4801-111111111111', 'dossier.json'),
            },
        ]);
        expect(run?.signalOutcome?.dismissedFiredSignals).toBe(1);
        expect(run?.signalOutcome?.undismissedFiredSignals).toEqual([]);
        expect(run?.reviewRounds).toHaveLength(1);
        expect(run?.reviewRounds[0]).toMatchObject({
            pr: 4801,
            headSha: HEAD_ONE,
            stanceDraws: 1,
            findingsAccepted: 1,
            recommendation: 'approve',
        });
    });

    it('accepts the literal citation token a round may use instead of a typed entry', () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [{ path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'recommend_investigation' }],
            })
        );
        writeDossier(
            root,
            '4801-111111111111',
            dossierFixture({
                pr: 4801,
                headSha: HEAD_ONE,
                limitation: 'weighed and discarded: semantic-signal assertion_deleted src/a.ts',
            })
        );

        const outcome = measure(root).runs[0]?.signalOutcome;

        expect(outcome?.dismissedFiredSignals).toBe(1);
        expect(outcome?.undismissedFiredSignals).toEqual([]);
        expect(outcome?.dispositionsRecorded).toEqual([]);
    });

    it("reports a fired signal as undismissed when the head's dossier disposes of none of it", () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [
                    { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'recommend_investigation' },
                    { path: 'src/b.ts', ruleId: 'timing_semantics_changed', disposition: 'recommend_investigation' },
                ],
            })
        );
        writeDossier(
            root,
            '4801-111111111111',
            dossierFixture({
                pr: 4801,
                headSha: HEAD_ONE,
                dispositions: [{ ruleId: 'assertion_deleted', path: 'src/a.ts', disposition: 'confirmed-existing' }],
            })
        );

        const outcome = measure(root).runs[0]?.signalOutcome;

        expect(outcome?.dismissedFiredSignals).toBe(1);
        expect(outcome?.undismissedFiredSignals).toEqual([{ ruleId: 'timing_semantics_changed', path: 'src/b.ts' }]);
        expect(measure(root).acrossRuns.signalDispositions.undismissedFiredSignals).toBe(1);
    });

    it('never reads a head with no dossier as a round that dismissed nothing', () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [{ path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'recommend_investigation' }],
            })
        );

        const record = measure(root);

        expect(record.runs[0]?.signalOutcome?.firedSignalsWithoutDossier).toBe(1);
        expect(record.runs[0]?.signalOutcome?.undismissedFiredSignals).toEqual([]);
        expect(record.acrossRuns.signalDispositions.withoutDossier).toBe(1);
        expect(record.notComputable.map((entry) => entry.figure)).toContain(
            'acrossRuns.signalDispositions.undismissedFiredSignals'
        );
    });

    it('reports the round figures as absent, and says so, when a head has no stored dossier', () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [
                    { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' },
                ],
            })
        );

        const record = measure(root);

        expect(record.runs[0]?.reviewRounds).toEqual([]);
        expect(record.acrossRuns.reviewRounds.dossiers).toBe(0);
        expect(record.notComputable.map((entry) => entry.figure)).toContain('runs[].reviewRounds');
    });
});

describe('repeated warnings', () => {
    function repeatedPair(headSha: string, prNumber: number): unknown {
        return scanFixture({
            headSha,
            prNumber,
            signals: [
                {
                    path: 'src/a.ts',
                    ruleId: 'admission_branch_completes_without_asserting',
                    disposition: 'recommend_investigation',
                },
            ],
        });
    }

    it('counts a pair flagged on more than one head of one pull request once, with its heads', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', repeatedPair(HEAD_ONE, 4801));
        writeSidecar(root, 'scan-2', repeatedPair(HEAD_TWO, 4801));

        const warnings = measure(root).acrossRuns.repeatedWarnings;

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toEqual({
            repository: 'acme/sourdaw',
            prNumber: 4801,
            ruleId: 'admission_branch_completes_without_asserting',
            path: 'src/a.ts',
            heads: [HEAD_ONE, HEAD_TWO].sort(),
        });
    });

    it('does not merge the same pair across two pull requests, and ignores a pair on one head', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', repeatedPair(HEAD_ONE, 4801));
        writeSidecar(root, 'scan-2', repeatedPair(HEAD_TWO, 4801));
        writeSidecar(root, 'scan-3', repeatedPair(HEAD_TWO, 4802));

        const warnings = measure(root).acrossRuns.repeatedWarnings;

        expect(warnings.map((warning) => warning.prNumber)).toEqual([4801]);
        expect(warnings[0]?.heads).toHaveLength(2);
    });

    it('leaves a run that names no pull request out of the count and names the gap', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', repeatedPair(HEAD_ONE, 4801));
        writeSidecar(root, 'scan-2', repeatedPair(HEAD_TWO, 4801));
        writeSidecar(root, 'scan-3', repeatedPair('3'.repeat(40), 4801));
        writeSidecar(
            root,
            'scan-4',
            scanFixture({
                headSha: '4'.repeat(40),
                signals: [
                    {
                        path: 'src/a.ts',
                        ruleId: 'admission_branch_completes_without_asserting',
                        disposition: 'recommend_investigation',
                    },
                ],
            })
        );

        const record = measure(root);

        expect(record.acrossRuns.repeatedWarnings).toHaveLength(1);
        expect(record.acrossRuns.repeatedWarnings[0]?.heads).toHaveLength(3);
        expect(record.notComputable.some((entry) => entry.figure === 'acrossRuns.repeatedWarnings')).toBe(true);
    });
});

describe('across-run totals', () => {
    it("sums the runs' own figures and counts them by artifact kind", () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        writeSidecar(root, 'scan-2', everyOmissionState(HEAD_TWO, 4801));

        const record = measure(root);

        expect(record.acrossRuns.runCount).toBe(2);
        expect(record.acrossRuns.runCountByKind).toEqual({ scan: 2 });
        expect(record.acrossRuns.ruleCoverage.applicableRules).toBe(10);
        expect(record.acrossRuns.ruleCoverage.askedRules).toBe(2);
        expect(record.acrossRuns.ruleCoverage.notAskedRules).toBe(8);
        expect(record.acrossRuns.derivedOutcomeStates).toEqual({
            notApplicable: 2,
            excludedWithAssessmentOwed: 2,
            missingRequiredEvidence: 2,
            omittedForBudgetOrDeadline: 2,
            providerFailure: 2,
            dryRun: 0,
        });
        // Only the dispositions a run actually returned are keys; a disposition nothing returned is
        // absent rather than present as a zero.
        expect(record.acrossRuns.signals.byDisposition).toEqual({ no_additional_recommendation: 6 });
        expect(record.acrossRuns.signals.fired).toBe(0);
        expect(record.acrossRuns.evidence.unitsMissingRequiredEvidence).toBe(4);
    });
});

describe("the evaluation runner's outcome file", () => {
    it("reads a fixture's asked and unasked rules and counts the labelled expectation apart from accuracy", () => {
        const root = checkout();
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(evaluationPath, `${JSON.stringify(evaluationOutcome(), null, 4)}\n`);

        const record = measure(root, { evaluationPath });

        expect(record.acrossRuns.runCountByKind).toEqual({ 'evaluation-fixture': 1 });
        expect(record.runs[0]?.ruleCoverage?.askedRules).toBe(1);
        expect(record.runs[0]?.ruleCoverage?.notAskedByReason['missing-required-evidence']).toBe(1);
        expect(record.acrossRuns.labelledExpectations).toEqual({ held: 1, total: 1, notAssessed: 0 });
        // The count is about the rules and the provider, and the record says so rather than calling it
        // an accuracy figure.
        expect(record.advisory).toContain('never an accuracy figure');
        expect(JSON.stringify(record)).not.toContain('"accuracy"');
    });

    it('marks the figures an evaluation outcome does not carry as not computable', () => {
        const root = checkout();
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(evaluationPath, `${JSON.stringify(evaluationOutcome(), null, 4)}\n`);

        const record = measure(root, { evaluationPath });
        const figures = record.notComputable.map((entry) => entry.figure);

        expect(record.runs[0]?.wallClock).toBeNull();
        expect(record.runs[0]?.context.repository).toBeNull();
        expect(record.runs[0]?.evidenceCompleteness.truncatedRegions).toBeNull();
        expect(figures).toContain('runs[].wallClock');
        expect(figures).toContain('runs[].evidenceCompleteness.truncatedRegions');
    });

    it('refuses a file that is not an evaluation outcome rather than recording no fixture', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(evaluationPath, `${JSON.stringify({ notOutcomes: [] })}\n`);

        expect(() => measure(root, { evaluationPath })).toThrow(/carries no outcomes array/u);
    });
});

describe('malformed and absent artifacts', () => {
    it('skips a sidecar the report validator refuses and names it instead of counting zero', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        // The older compound-answer shape a retained sidecar really has: the same signal without the
        // atomic `probability` the current validator requires.
        const stale = everyOmissionState(HEAD_TWO, 4801) as { signals: Record<string, unknown>[] };
        const storedSignal = stale.signals[0] as Record<string, unknown>;
        const staleSignal: Record<string, unknown> = { ...storedSignal, probabilities: { yes: 1 } };
        delete staleSignal.probability;
        writeRawSidecar(root, 'scan-broken', `${JSON.stringify({ ...stale, signals: [staleSignal] })}\n`);

        const record = measure(root);

        expect(record.runs).toHaveLength(1);
        expect(record.acrossRuns.runCount).toBe(1);
        expect(record.skippedArtifacts).toHaveLength(1);
        expect(record.skippedArtifacts[0]?.path).toContain('scan-broken');
        expect(record.skippedArtifacts[0]?.reason).toMatch(/probability/u);
        expect(record.notComputable.some((entry) => entry.figure.includes('scan-broken'))).toBe(true);
    });

    it('refuses the malformed artifact outright in strict mode', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        writeRawSidecar(root, 'scan-broken', '{ not json');

        expect(() => measure(root, { strict: true })).toThrow(/could not be read/u);
    });

    it('skips a dossier that does not read and still measures the runs', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        const directory = join(root, '.agents', 'review-bundles', '4801-111111111111');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'dossier.json'), '{ not json');

        const record = measure(root);

        expect(record.runs).toHaveLength(1);
        expect(record.runs[0]?.signalOutcome?.dossiersMatched).toEqual([]);
        expect(record.skippedArtifacts[0]?.reason).toContain('not valid JSON');
    });

    it('refuses a checkout with nothing to measure rather than recording figures nothing stands behind', () => {
        const root = checkout();
        mkdirSync(join(root, '.agents', 'semantic-review'), { recursive: true });

        expect(() => measure(root)).toThrow(/refusing to record figures nothing stands behind/u);
    });

    it('names the runs whose stored report carries no scope states', () => {
        const root = checkout();
        const report = everyOmissionState(HEAD_ONE, 4801) as { scope: Record<string, unknown> };
        delete report.scope.states;
        writeSidecar(root, 'scan-1', report);

        const record = measure(root);

        expect(record.runs[0]?.outcomeAccounting.publishedStates).toBeNull();
        expect(record.notComputable.map((entry) => entry.figure)).toContain('runs[].outcomeAccounting.publishedStates');
    });
});

describe('the record itself', () => {
    it('names its format, its measurement time, how it was measured, and where each figure came from', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const record = measure(root);

        expect(record.format).toBe('semantic-review-measurement-v1');
        expect(record.schemaVersion).toBe(1);
        expect(record.measuredAt).toBe(MEASURED_AT);
        expect(record.machine).toEqual(MACHINE);
        expect(record.sources.storedRunsRead).toBe(1);
        expect(record.sources.detail).toBe('runs');
        expect(record.sources.sidecarRootPresent).toBe(true);
        expect(record.fieldSources['runs[].usage']).toContain('#usage');
        expect(record.fieldSources['runs[].wallClock']).toContain('span');
        expect(record.runs[0]?.artifact.sha256).toMatch(/^[0-9a-f]{64}$/u);
    });
});

/**
 * The advisory semantic review scans every changed TypeScript file with the trusted snapshot's import
 * scanner, and these are the measurement entry's own sources. The scanner once ended the process with
 * `Maximum call stack size exceeded` on a division after a parenthesized member expression inside a
 * template interpolation (#4934), which cost the review its assessment of any change carrying the shape;
 * an earlier revision of these sources carried it, so the case keeps them scanned rather than described.
 */
describe("the trusted import scanner reads this lane's sources", () => {
    it.each([
        ['the measurement entry', '../semanticReviewMeasurement.ts'],
        ['the record shape', '../semanticReviewMeasurement/contracts.ts'],
        ['the per-artifact derivation', '../semanticReviewMeasurement/artifacts.ts'],
        ['the across-run aggregation', '../semanticReviewMeasurement/record.ts'],
    ])('scans %s without recursing without bound', (_label, relativePath) => {
        const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

        expect(() => snapshotImportSpecifiers(source)).not.toThrow();
    });
});

describe('detail levels', () => {
    it('publishes the across-run figures and the gaps with no per-run entry by default', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        writeSidecar(root, 'scan-2', everyOmissionState(HEAD_TWO, 4801));

        const record = measure(root, { detail: 'aggregate' });

        expect(record.sources.detail).toBe('aggregate');
        expect(record.runs).toEqual([]);
        expect(record.acrossRuns.runCount).toBe(2);
        expect(record.acrossRuns.ruleCoverage.applicableRules).toBe(10);
        expect(record.acrossRuns.usage.networkAttempts).toBe(4);
        // The legend describes this record, not the fields a fuller one would carry.
        expect(record.fieldSources['runs[]']).toContain('not published at this detail level');
        expect(record.fieldSources['runs[].usage']).toBeUndefined();
    });

    it('names an aggregate-level gap against the total it leaves short, not a per-run field', () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [
                    { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' },
                ],
                unassessed: [{ path: 'src/b.ts', reason: 'budget-exhausted-before-admission' }],
            })
        );

        const aggregate = measure(root, { detail: 'aggregate' });
        const full = measure(root, { detail: 'runs' });

        expect(aggregate.notComputable.map((entry) => entry.figure)).toContain(
            'acrossRuns.ruleCoverage.applicableRules'
        );
        expect(full.notComputable.map((entry) => entry.figure)).toContain('runs[].ruleCoverage.applicableRules');
        // The gap itself is the same gap at either level: only the field it is named against changes.
        expect(aggregate.notComputable.map((entry) => entry.reason)).toEqual(
            full.notComputable.map((entry) => entry.reason)
        );
    });

    it('parses --detail into the full level and defaults to the aggregate one', () => {
        expect(parseCommandLine([]).detail).toBe('aggregate');
        expect(parseCommandLine(['--detail']).detail).toBe('runs');
    });
});

describe('an evaluation fixture in the set-wide figures', () => {
    function fixtureRoot(limitations: readonly string[] = []): { root: string; evaluationPath: string } {
        const root = checkout();
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(evaluationPath, `${JSON.stringify(evaluationOutcome({ limitations }), null, 4)}\n`);
        return { root, evaluationPath };
    }

    it('folds the fixture rules, signals and texts into the vocabularies its totals already reach', () => {
        const { root, evaluationPath } = fixtureRoot(['the corpus fixture had no caller context']);

        const record = measure(root, { evaluationPath, detail: 'aggregate' });

        // The totals these vocabularies sit beside already count the fixture, so the vocabularies must
        // name it: a run whose signals total 1 and whose byRule is empty is a run with no rule.
        expect(record.acrossRuns.signals.total).toBe(1);
        expect(record.acrossRuns.signals.byRule).toEqual({ assertion_deleted: 1 });
        expect(record.acrossRuns.ruleCoverage.askedRules).toBe(1);
        expect(record.acrossRuns.ruleCoverage.notAskedRules).toBe(1);
        expect(record.acrossRuns.ruleCoverage.notAskedByRule).toEqual({ timing_semantics_changed: 1 });
        expect(record.acrossRuns.evidence.limitationsByText).toEqual({
            'the corpus fixture had no caller context': 1,
        });
        expect(record.acrossRuns.evidence.unitsMissingRequiredEvidence).toBe(1);
    });

    it('publishes no scope ledger for an artifact that carries none', () => {
        const { root, evaluationPath } = fixtureRoot();

        const record = measure(root, { evaluationPath, detail: 'runs' });

        expect(record.runs[0]?.outcomeAccounting.derivedFromEntries).toBeNull();
        expect(record.runs[0]?.outcomeAccounting.publishedStates).toBeNull();
        expect(record.acrossRuns.derivedOutcomeStates).toBeNull();
        expect(record.acrossRuns.derivedOutcomeRuns).toBe(0);
        const figures = record.notComputable.map((entry) => entry.figure);
        expect(figures).toContain('runs[].outcomeAccounting.derivedFromEntries');
        // The revision context is the other figure its artifact cannot carry, and it is named too.
        expect(figures).toContain('runs[].context');
        expect(record.acrossRuns.signals.total).toBe(1);
    });

    it('counts the omission totals over the runs that carry a ledger and names how many those are', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(evaluationPath, `${JSON.stringify(evaluationOutcome(), null, 4)}\n`);

        const record = measure(root, { evaluationPath, detail: 'aggregate' });

        expect(record.acrossRuns.runCount).toBe(2);
        expect(record.acrossRuns.derivedOutcomeRuns).toBe(1);
        expect(record.acrossRuns.derivedOutcomeStates).toMatchObject({
            omittedForBudgetOrDeadline: 1,
            providerFailure: 1,
            missingRequiredEvidence: 1,
        });
        // The fixture is still counted as a run, and its rules reach the vocabularies beside the scan's.
        expect(record.acrossRuns.signals.byRule).toMatchObject({ assertion_deleted: 2 });
    });
});

describe('review rounds across heads', () => {
    it('counts one round once when a head has both a scan and a verification sidecar', () => {
        const root = checkout();
        writeSidecar(
            root,
            'scan-1',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [{ path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'recommend_investigation' }],
            })
        );
        writeSidecar(root, 'verif-1', verificationFixture(HEAD_ONE, 4801), 'verification.json');
        writeDossier(
            root,
            '4801-111111111111',
            dossierFixture({
                pr: 4801,
                headSha: HEAD_ONE,
                findingsAccepted: 2,
                dispositions: [{ ruleId: 'assertion_deleted', path: 'src/a.ts', disposition: 'confirmed-existing' }],
            })
        );

        const rounds = measure(root).acrossRuns.reviewRounds;

        // Both runs match one dossier; the head is one round, whatever read it.
        expect(rounds.heads).toBe(1);
        expect(rounds.dossiers).toBe(1);
        expect(rounds.stanceDraws).toBe(1);
        expect(rounds.findingsAccepted).toBe(2);
        expect(rounds.findingsDiscarded).toBe(0);
        expect(rounds.reviewsPublished).toBe(0);
    });

    it('still counts two heads as two rounds', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        writeSidecar(root, 'scan-2', everyOmissionState(HEAD_TWO, 4801));
        writeDossier(root, '4801-111111111111', dossierFixture({ pr: 4801, headSha: HEAD_ONE }));
        writeDossier(root, '4801-222222222222', dossierFixture({ pr: 4801, headSha: HEAD_TWO }));

        expect(measure(root).acrossRuns.reviewRounds).toMatchObject({ heads: 2, dossiers: 2, stanceDraws: 2 });
    });
});

describe('execution states', () => {
    function mixedStatesRoot(): string {
        const root = checkout();
        writeSidecar(
            root,
            'scan-completed',
            scanFixture({
                headSha: HEAD_ONE,
                prNumber: 4801,
                signals: [
                    { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' },
                ],
            })
        );
        writeSidecar(
            root,
            'scan-partial',
            scanFixture({
                headSha: HEAD_TWO,
                prNumber: 4801,
                signals: [
                    { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'no_additional_recommendation' },
                ],
                truncated: [{ path: 'src/a.ts', reason: 'unit-evidence-reduced-below-request-budget' }],
            })
        );
        writeSidecar(
            root,
            'scan-unavailable',
            scanFixture({
                headSha: '3'.repeat(40),
                prNumber: 4802,
                signals: [],
                unassessed: [{ path: 'src/b.ts', reason: 'provider_unavailable' }],
                execution: 'unavailable',
                failureCode: 'provider_unavailable',
            })
        );
        return root;
    }

    it('counts the execution state of every run it read, per run and across runs', () => {
        const record = measure(mixedStatesRoot());

        expect(record.acrossRuns.executionStates).toEqual({
            completed: 1,
            partial: 1,
            unavailable: 1,
        });
        expect(record.runs.map((run) => run.execution)).toEqual(['completed', 'partial', 'unavailable']);
        expect(record.runs.map((run) => run.failureCode)).toEqual([null, null, 'provider_unavailable']);
    });

    it('names the failure codes beside the states, so an unavailable run keeps its cause', () => {
        const record = measure(mixedStatesRoot());

        expect(record.acrossRuns.failureCodes).toEqual({ provider_unavailable: 1 });
    });

    it('states the execution states in the human summary', () => {
        const summary = renderMeasurementSummary(measure(mixedStatesRoot()));

        expect(summary).toContain('execution states: completed 1, partial 1, unavailable 1');
        expect(summary).toContain('failure codes: provider_unavailable 1');
    });
});

/**
 * Whether a legend key names a field the record actually carries. `runs[]` walks into the first
 * element, and a key that also lists sibling fields (`a/b`) or qualifies itself in prose
 * (`runs[].ruleCoverage for verification runs`) is read by its first path segment.
 */
function legendKeyResolves(record: unknown, field: string): boolean {
    const path = (field.split(' ')[0] ?? '').split('/')[0] ?? '';
    let current: unknown = record;
    for (const raw of path.split('.')) {
        const key = raw.replace(/\[\]$/u, '');
        if (Array.isArray(current)) {
            if (current.length === 0) {
                return true;
            }
            current = current[0];
        }
        if (typeof current !== 'object' || current === null || !(key in current)) {
            return false;
        }
        current = (current as Record<string, unknown>)[key];
    }
    return true;
}

describe('the field legend', () => {
    it.each([
        ['the aggregate level', 'aggregate'],
        ['the full level', 'runs'],
    ] as const)('names only fields the record carries at %s', (_label, detail) => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));
        writeDossier(root, '4801-111111111111', dossierFixture({ pr: 4801, headSha: HEAD_ONE }));

        const record = measure(root, { detail });

        expect(Object.keys(record.fieldSources).length).toBeGreaterThan(10);
        for (const field of Object.keys(record.fieldSources)) {
            expect({ field, resolves: legendKeyResolves(record, field) }).toEqual({ field, resolves: true });
        }
    });

    it('names both artifacts a per-rule signal figure is summed from', () => {
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const legend = measure(root, { detail: 'aggregate' }).fieldSources['acrossRuns.signals.byRule'];

        expect(legend).toContain('#signals[].ruleId');
        expect(legend).toContain('#outcomes[].ruleId');
    });

    it('names the fixture fields the coverage figures are read from, not the ones they are not', () => {
        // `#rulesAsked` is validated but never read: asked coverage is derived from the fixture's own
        // outcomes and missing evidence, so a reader reproducing it from this legend would get the
        // contradiction the derivation removed.
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const legend = measure(root, { detail: 'runs' }).fieldSources['runs[].ruleCoverage'];

        expect(legend).toContain('#outcomes[].ruleId');
        expect(legend).toContain('#missingEvidenceByRule');
        expect(legend).toContain('#rulesNotAsked[].{ruleId,missingEvidence}');
        expect(legend).not.toContain('#rulesAsked');
    });
});

describe('a measurement that carries no signal ledger', () => {
    function verificationOnlyRoot(): string {
        const root = checkout();
        writeSidecar(root, 'verif-1', verificationFixture(HEAD_ONE, 4801), 'verification.json');
        writeSidecar(root, 'verif-2', verificationFixture(HEAD_TWO, 4802), 'verification.json');
        return root;
    }

    it('publishes null with the contributing-run count rather than a row of zeros', () => {
        const record = measure(verificationOnlyRoot(), { detail: 'aggregate' });

        expect(record.acrossRuns.signals.total).toBeNull();
        expect(record.acrossRuns.signals.byDisposition).toBeNull();
        expect(record.acrossRuns.signals.byRule).toBeNull();
        expect(record.acrossRuns.signals.fired).toBeNull();
        expect(record.acrossRuns.signals.runsWithSignalLedger).toBe(0);
        // The finding ledger is what these runs do carry, and it stays published.
        expect(record.acrossRuns.signals.runsWithFindingLedger).toBe(2);
        expect(record.acrossRuns.signals.byFindingDisposition).toEqual({
            ready_for_orchestrator_validation: 2,
        });
        expect(record.notComputable.map((entry) => entry.figure)).toContain('acrossRuns.signals');
    });

    it('says so in the summary and names the finding ledger it did read', () => {
        const summary = renderMeasurementSummary(measure(verificationOnlyRoot(), { detail: 'aggregate' }));

        expect(summary).toContain('signals: no artifact read carries a signal ledger');
        expect(summary).toContain('finding dispositions: ready_for_orchestrator_validation 2');
    });

    it('publishes null dispositions with the gap named rather than a row of zeros', () => {
        // Nothing fired in these runs, so nothing could be disposed of. A zero recorded, zero dismissed
        // row would read as a round that dismissed nothing, which is a different claim.
        const record = measure(verificationOnlyRoot(), { detail: 'aggregate' });

        expect(record.acrossRuns.signalDispositions).toEqual({
            recorded: null,
            byToken: null,
            dismissedFiredSignals: null,
            undismissedFiredSignals: null,
            withoutDossier: null,
        });
        expect(record.notComputable.map((entry) => entry.figure)).toContain('acrossRuns.signalDispositions');
    });

    it('says the dispositions are not computable in the summary instead of printing zeros', () => {
        const summary = renderMeasurementSummary(measure(verificationOnlyRoot(), { detail: 'aggregate' }));

        expect(summary).toContain('dispositions: no artifact read carries a signal ledger');
        expect(summary).not.toContain('dispositions: 0 recorded');
    });
});

describe('disposals across several sidecars of one head', () => {
    function twoSidecarsOneHead(withDossier: boolean): string {
        const root = checkout();
        const signals = [
            { path: 'src/a.ts', ruleId: 'assertion_deleted', disposition: 'recommend_investigation' as const },
            { path: 'src/b.ts', ruleId: 'timing_semantics_changed', disposition: 'recommend_investigation' as const },
        ];
        writeSidecar(root, 'scan-1', scanFixture({ headSha: HEAD_ONE, prNumber: 4801, signals }));
        writeSidecar(root, 'scan-2', scanFixture({ headSha: HEAD_ONE, prNumber: 4801, signals }));
        if (withDossier) {
            writeDossier(
                root,
                '4801-111111111111',
                dossierFixture({
                    pr: 4801,
                    headSha: HEAD_ONE,
                    dispositions: [
                        { ruleId: 'assertion_deleted', path: 'src/a.ts', disposition: 'confirmed-existing' },
                    ],
                })
            );
        }
        return root;
    }

    it("counts a dossier's dispositions and dismissals once, not once per sidecar", () => {
        const record = measure(twoSidecarsOneHead(true), { detail: 'aggregate' });

        expect(record.acrossRuns.runCount).toBe(2);
        expect(record.acrossRuns.signalDispositions.recorded).toBe(1);
        expect(record.acrossRuns.signalDispositions.byToken).toEqual({ 'confirmed-existing': 1 });
        expect(record.acrossRuns.signalDispositions.dismissedFiredSignals).toBe(1);
        expect(record.acrossRuns.signalDispositions.undismissedFiredSignals).toBe(1);
        // The per-run signal counts stay per run: those measure what was asked, not what was disposed.
        expect(record.acrossRuns.signals.fired).toBe(4);
    });

    it("counts a head's undisposed signals once when no dossier records the head", () => {
        const record = measure(twoSidecarsOneHead(false), { detail: 'aggregate' });

        expect(record.acrossRuns.signalDispositions.withoutDossier).toBe(2);
        expect(record.acrossRuns.signalDispositions.undismissedFiredSignals).toBe(0);
    });
});

describe('the fixture label against the fixture ledger', () => {
    it('names the held rate not computable when no evaluation artifact was read', () => {
        // The figure is null for a corpus that was never read, which is not the same as a rate over
        // nothing; the legend promises every null aggregate figure is named, and a cold reader of the
        // committed record has only the record to tell the two apart.
        const root = checkout();
        writeSidecar(root, 'scan-1', everyOmissionState(HEAD_ONE, 4801));

        const aggregate = measure(root, { detail: 'aggregate' });
        const full = measure(root, { detail: 'runs' });

        expect(aggregate.acrossRuns.labelledExpectations).toBeNull();
        expect(aggregate.sources.evaluationFixturesRead).toBe(0);
        expect(aggregate.notComputable.map((entry) => entry.figure)).toContain('acrossRuns.labelledExpectations');
        expect(full.notComputable.map((entry) => entry.figure)).toContain('runs[].labelledExpectationHeld');
        // The gap is the same gap at either level; only the field it is named against changes.
        expect(aggregate.notComputable.map((entry) => entry.reason)).toEqual(
            full.notComputable.map((entry) => entry.reason)
        );
    });

    it('keeps an unassessed fixture out of the held rate and names it', () => {
        const root = checkout();
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(
            evaluationPath,
            `${JSON.stringify(
                {
                    outcomes: [
                        (evaluationOutcome() as { outcomes: unknown[] }).outcomes[0],
                        (
                            evaluationOutcome({
                                fixtureId: 'fixture-2',
                                execution: 'unavailable',
                                expectedConcernHeld: false,
                            }) as { outcomes: unknown[] }
                        ).outcomes[0],
                    ],
                },
                null,
                4
            )}\n`
        );

        const record = measure(root, { evaluationPath, detail: 'aggregate' });

        expect(record.acrossRuns.labelledExpectations).toEqual({ held: 1, total: 1, notAssessed: 1 });
        expect(record.acrossRuns.executionStates).toEqual({ completed: 1, unavailable: 1 });
    });

    it('keeps a completed fixture that never asked its labelled rule out of the held rate', () => {
        // The runner's own execution state says the run finished, not that the question was put: the
        // second fixture completed while its ledger records its labelled rule as unasked, so its label
        // is an absent answer and belongs in notAssessed beside the unassessed fixture.
        const root = checkout();
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(
            evaluationPath,
            `${JSON.stringify(
                {
                    outcomes: [
                        (evaluationOutcome() as { outcomes: unknown[] }).outcomes[0],
                        (
                            evaluationOutcome({
                                fixtureId: 'fixture-2',
                                execution: 'completed',
                                expectedConcernHeld: true,
                                missingEvidenceByRule: { assertion_deleted: ['after source'] },
                            }) as { outcomes: unknown[] }
                        ).outcomes[0],
                    ],
                },
                null,
                4
            )}\n`
        );

        const record = measure(root, { evaluationPath, detail: 'aggregate' });

        expect(record.acrossRuns.labelledExpectations).toEqual({ held: 1, total: 1, notAssessed: 1 });
        // The ledger is what decides: the second fixture's own rule went unasked, and only the first
        // asked the rule it labelled.
        expect(record.acrossRuns.ruleCoverage.askedRules).toBe(1);
        expect(record.acrossRuns.ruleCoverage.notAskedByRule).toEqual({
            assertion_deleted: 1,
            timing_semantics_changed: 2,
        });
    });

    it('reads asked and not-asked from the fixture ledger, so one rule cannot be both', () => {
        const root = checkout();
        const evaluationPath = join(root, 'evaluation.json');
        // The runner's own lists call the rule unasked while its outcome carries no missing evidence:
        // the ledger decides, exactly as it does on the stored path.
        writeFileSync(
            evaluationPath,
            `${JSON.stringify(
                evaluationOutcome({
                    rulesAsked: [],
                    rulesNotAsked: [{ ruleId: 'assertion_deleted', missingEvidence: ['after source'] }],
                    missingEvidenceByRule: {},
                    outcomes: [
                        {
                            ruleId: 'assertion_deleted',
                            outcome: 'no_signal',
                            probability: 0.1,
                            disposition: 'no_additional_recommendation',
                            reasoning: 'fixture',
                        },
                    ],
                }),
                null,
                4
            )}\n`
        );

        const record = measure(root, { evaluationPath, detail: 'aggregate' });

        expect(record.acrossRuns.ruleCoverage.askedRules).toBe(1);
        expect(record.acrossRuns.ruleCoverage.notAskedRules).toBe(0);
        expect(record.acrossRuns.ruleCoverage.notAskedByRule).toEqual({});
        expect(record.acrossRuns.signals.byDisposition).toEqual({ no_additional_recommendation: 1 });
    });

    it('still publishes a rule the ledger records as unasked, with its missing evidence', () => {
        const root = checkout();
        const evaluationPath = join(root, 'evaluation.json');
        writeFileSync(
            evaluationPath,
            `${JSON.stringify(
                evaluationOutcome({
                    rulesAsked: ['assertion_deleted'],
                    rulesNotAsked: [],
                    missingEvidenceByRule: { assertion_deleted: ['after source'] },
                }),
                null,
                4
            )}\n`
        );

        const record = measure(root, { evaluationPath, detail: 'aggregate' });

        expect(record.acrossRuns.ruleCoverage.askedRules).toBe(0);
        expect(record.acrossRuns.ruleCoverage.notAskedRules).toBe(1);
        expect(record.acrossRuns.ruleCoverage.notAskedByRule).toEqual({ assertion_deleted: 1 });
        expect(record.acrossRuns.evidence.requiredEvidenceTokensMissing).toEqual({ 'after source': 1 });
    });
});
