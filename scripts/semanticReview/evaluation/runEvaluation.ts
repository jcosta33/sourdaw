/**
 * The OPT-IN live evaluation of the adjudicated corpus.
 *
 * This module is the runner's whole behaviour: one `runScan` per corpus fixture, over a source the caller
 * supplies, with a provider the caller supplies, and a report of what was asked, what evidence and facts
 * travelled, and what came back raw. It never decides whether a change is safe; it reports whether the
 * labelled expectation held, so a person reads the outcome rather than a score.
 *
 * It is deliberately not wired into CI, into a unit test, or into any publication path. The unit tests
 * around it drive the same functions with a stubbed provider port and a corpus-backed source, which is why
 * the rendering and the extraction live here rather than in the command-line entry.
 */

import { type ScanAssessment, type ScanDisposition } from '../interpret.ts';
import { type SemanticCachePort, type SemanticProviderPort, type SemanticRawResponse } from '../provider.ts';
import { type SemanticUsageReport } from '../report.ts';
import { semanticRule, type SemanticBudgetProfile, type SemanticRuleId, type ScanOutcome } from '../rules.ts';
import { runScan, type SemanticClock } from '../run.ts';

import type { UnitChangedLineFacts } from '../changeFacts.ts';
import type { SemanticExecutionState, SemanticRevisionBase } from '../contracts.ts';
import type { SemanticSourcePort } from '../evidence.ts';
import type { EvaluationCorpus, EvaluationExpectation, EvaluationFixture } from './corpus.ts';

/** What one fixture's assessment is run over. The caller resolves Git refs or a corpus text; this does not. */
export type EvaluationFixturePlan = {
    readonly source: SemanticSourcePort;
    readonly sourceKind: 'git-revisions' | 'corpus-fixture';
    readonly revision: SemanticRevisionBase;
};

export type SemanticEvaluationPorts = {
    readonly provider: SemanticProviderPort;
    readonly cache: SemanticCachePort;
    readonly clock: SemanticClock;
    readonly signal: AbortSignal;
    readonly log: (message: string) => void;
};

/** One rule's raw answer, exactly as the interpreter read it: no thresholding reinterpreted here. */
export type EvaluationRuleOutcome = {
    readonly ruleId: SemanticRuleId;
    readonly outcome: ScanOutcome;
    readonly probability: number;
    readonly disposition: ScanDisposition;
    readonly reasoning: string;
};

export type EvaluationFixtureOutcome = {
    readonly fixtureId: string;
    readonly kind: EvaluationFixture['fixture'];
    readonly path: string;
    /** The rule this fixture adjudicates. */
    readonly ruleId: SemanticRuleId;
    readonly sourceKind: EvaluationFixturePlan['sourceKind'];
    readonly execution: SemanticExecutionState;
    readonly failureCode?: string;
    readonly requestedModel: string;
    readonly returnedModels: readonly string[];
    /** The rules some request of this unit actually carried a question for, in the unit's rule order. */
    readonly rulesAsked: readonly SemanticRuleId[];
    /** The rules no request asked, each with the required evidence no pass carried. */
    readonly rulesNotAsked: readonly {
        readonly ruleId: SemanticRuleId;
        readonly missingEvidence: readonly string[];
    }[];
    readonly evidenceSupplied: readonly string[];
    readonly missingEvidenceByRule: Readonly<Record<string, readonly string[]>>;
    readonly thresholds: Readonly<Record<string, number>>;
    /** The facts the request actually carried, read back from the state the provider was handed. */
    readonly factsCarried?: UnitChangedLineFacts;
    /** Whether the carried facts are the block the corpus records; absent when nothing was carried. */
    readonly factsMatchCorpus?: boolean;
    readonly outcomes: readonly EvaluationRuleOutcome[];
    readonly expected: EvaluationExpectation;
    /** Whether the labelled expectation held: asked, and answered on the side the label claims. */
    readonly expectedConcernHeld: boolean;
    /** Signals on rules other than the one under test; informative, and never part of this label. */
    readonly otherSignals: readonly SemanticRuleId[];
    readonly providerRequests: number;
    readonly usage: SemanticUsageReport;
    readonly limitations: readonly string[];
};

export type SemanticEvaluationResult = {
    readonly outcomes: readonly EvaluationFixtureOutcome[];
    readonly providerRequests: number;
    readonly signals: number;
    readonly expectationsHeld: number;
};

/** One request as the provider was handed it, read from the state rather than recomputed. */
type RecordedRequest = {
    readonly changedLineFacts: UnitChangedLineFacts | undefined;
};

function readRecordedRequest(state: unknown): RecordedRequest {
    if (typeof state !== 'object' || state === null) {
        return { changedLineFacts: undefined };
    }
    const unit = (state as Record<string, unknown>).unit;
    if (typeof unit !== 'object' || unit === null) {
        return { changedLineFacts: undefined };
    }
    const carried = (unit as Record<string, unknown>).changedLines;
    if (typeof carried !== 'object' || carried === null) {
        return { changedLineFacts: undefined };
    }
    return { changedLineFacts: carried as UnitChangedLineFacts };
}

/**
 * The provider port with every request's carried facts recorded. Recording what the provider was actually
 * handed is the point: a report that recomputed the block from the source could agree with the corpus
 * while the request carried something else.
 */
function recordingProvider(port: SemanticProviderPort, requests: RecordedRequest[]): SemanticProviderPort {
    return {
        systemOne: async (request): Promise<SemanticRawResponse> => {
            requests.push(readRecordedRequest(request.state));
            return port.systemOne(request);
        },
    };
}

/**
 * The revision context a corpus-backed fixture is assessed under: the fixture's own revision pair, labelled
 * as an evaluation fixture. A revision fixture the live runner resolves through Git gets that resolution's
 * own context instead; this one is for a fixture whose regions came from the corpus.
 */
export function fixtureEvaluationRevision(fixture: EvaluationFixture): SemanticRevisionBase {
    return {
        repository: 'synthetic-evaluation-fixture',
        repositoryId: 'synthetic-evaluation-fixture',
        headSha: fixture.revisions.headSha,
        targetBaseSha: fixture.revisions.mergeBaseSha,
        mergeBaseSha: fixture.revisions.mergeBaseSha,
        trustedExecutionSha: fixture.revisions.headSha,
        contractSourceSha: fixture.revisions.mergeBaseSha,
    };
}

function ruleOutcomes(signals: readonly ScanAssessment[]): EvaluationRuleOutcome[] {
    return signals.map((signal) => ({
        ruleId: signal.ruleId,
        outcome: signal.outcome,
        probability: signal.probability,
        disposition: signal.disposition,
        reasoning: signal.reasoning,
    }));
}

/** Whether the labelled expectation held, and never treating an unasked question as agreement. */
function expectationHeld(
    expected: EvaluationExpectation,
    asked: readonly SemanticRuleId[],
    outcome: EvaluationRuleOutcome | undefined
): boolean {
    if (outcome === undefined || !asked.includes(outcome.ruleId)) {
        return false;
    }
    return expected.concern === 'none' ? outcome.outcome === 'no_signal' : outcome.outcome === 'signal';
}

async function evaluateFixture(input: {
    readonly fixture: EvaluationFixture;
    readonly plan: EvaluationFixturePlan;
    readonly ports: SemanticEvaluationPorts;
    readonly profile: SemanticBudgetProfile;
    readonly runId: string;
}): Promise<EvaluationFixtureOutcome> {
    const requests: RecordedRequest[] = [];
    const result = await runScan({
        ports: {
            source: input.plan.source,
            provider: recordingProvider(input.ports.provider, requests),
            cache: input.ports.cache,
            clock: input.ports.clock,
            signal: input.ports.signal,
            log: input.ports.log,
        },
        revision: input.plan.revision,
        profile: input.profile,
        // The scan CLI's own wiring: the per-region ceiling sits inside the per-request state budget, and
        // the run-wide ceiling is the total submitted-byte budget.
        limits: {
            maxRegionBytes: input.profile.maxStatePlusQuestionBytes,
            maxTotalBytes: input.profile.maxTotalSubmittedBytes,
        },
        contractPaths: [],
        runId: `${input.runId}-${input.fixture.id}`,
        dryRun: false,
    });
    const preview = result.previews[0];
    const stored = result.storedResponses[0];
    const rulesAsked = preview?.askedRuleIds ?? [];
    const asked = new Set<string>(rulesAsked);
    const rulesNotAsked = (preview?.ruleIds ?? [])
        .filter((ruleId) => !asked.has(ruleId))
        .map((ruleId) => ({ ruleId, missingEvidence: stored?.missingEvidence[ruleId] ?? [] }));
    const thresholds: Record<string, number> = {};
    for (const ruleId of preview?.ruleIds ?? []) {
        thresholds[ruleId] = semanticRule(ruleId).thresholds.fire;
    }
    const outcomes = ruleOutcomes(result.report.signals);
    const carried = requests.find((request) => request.changedLineFacts !== undefined)?.changedLineFacts;
    const fixtureOutcome: EvaluationFixtureOutcome = {
        fixtureId: input.fixture.id,
        kind: input.fixture.fixture,
        path: input.fixture.path,
        ruleId: input.fixture.ruleId,
        sourceKind: input.plan.sourceKind,
        execution: result.report.execution,
        failureCode: result.report.failureCode,
        requestedModel: result.report.requestedModel,
        returnedModels: result.report.returnedModels,
        rulesAsked,
        rulesNotAsked,
        evidenceSupplied: preview?.sentEvidenceIds ?? [],
        missingEvidenceByRule: stored?.missingEvidence ?? {},
        thresholds,
        factsCarried: carried,
        factsMatchCorpus: recordedFactsMatch(carried, input.fixture.changedLineFacts),
        outcomes,
        expected: input.fixture.expected,
        expectedConcernHeld: expectationHeld(
            input.fixture.expected,
            rulesAsked,
            outcomes.find((outcome) => outcome.ruleId === input.fixture.ruleId)
        ),
        otherSignals: outcomes
            .filter((outcome) => outcome.outcome === 'signal' && outcome.ruleId !== input.fixture.ruleId)
            .map((outcome) => outcome.ruleId),
        providerRequests: requests.length,
        usage: result.report.usage,
        limitations: result.report.limitations,
    };
    return fixtureOutcome;
}

/**
 * Assesses every fixture in the corpus, one `runScan` each. Each fixture is a separate run because the
 * revision context, the source, and the unit are per fixture; a single shared run would assess the union
 * of the corpus and could not attribute an outcome to a label.
 */
export async function runEvaluation(input: {
    readonly corpus: EvaluationCorpus;
    readonly ports: SemanticEvaluationPorts;
    readonly profile: SemanticBudgetProfile;
    readonly planFor: (fixture: EvaluationFixture) => EvaluationFixturePlan;
    readonly runId: string;
}): Promise<SemanticEvaluationResult> {
    const outcomes: EvaluationFixtureOutcome[] = [];
    for (const fixture of input.corpus.fixtures) {
        outcomes.push(
            await evaluateFixture({
                fixture,
                plan: input.planFor(fixture),
                ports: input.ports,
                profile: input.profile,
                runId: input.runId,
            })
        );
    }
    return {
        outcomes,
        providerRequests: outcomes.reduce((total, outcome) => total + outcome.providerRequests, 0),
        signals: outcomes.reduce(
            (total, outcome) => total + outcome.outcomes.filter((entry) => entry.outcome === 'signal').length,
            0
        ),
        expectationsHeld: outcomes.filter((outcome) => outcome.expectedConcernHeld).length,
    };
}

/**
 * Whether the facts a request carried are the block the corpus records, or undefined when no request
 * carried any: a unit whose evidence never left reports nothing, and `false` would read as disagreement.
 */
function recordedFactsMatch(
    carried: UnitChangedLineFacts | undefined,
    recorded: UnitChangedLineFacts
): boolean | undefined {
    if (carried === undefined) {
        return undefined;
    }
    return JSON.stringify(carried) === JSON.stringify(recorded);
}

function renderRuleList(ruleIds: readonly SemanticRuleId[]): string {
    return ruleIds.length === 0 ? 'none' : ruleIds.join(', ');
}

function renderThresholds(thresholds: Readonly<Record<string, number>>): string {
    const entries = Object.entries(thresholds).map(([ruleId, fire]) => `${ruleId} >= ${fire.toFixed(2)}`);
    return entries.length === 0 ? 'none' : entries.join('; ');
}

/** The questions no request asked, each with the required evidence no pass carried. */
function renderNotAsked(rulesNotAsked: EvaluationFixtureOutcome['rulesNotAsked']): string {
    if (rulesNotAsked.length === 0) {
        return 'none';
    }
    return rulesNotAsked
        .map(
            (entry) =>
                `${entry.ruleId} (missing ${entry.missingEvidence.length === 0 ? 'nothing' : entry.missingEvidence.join(', ')})`
        )
        .join('; ');
}

function renderOutcome(outcome: EvaluationRuleOutcome): string {
    return `${outcome.ruleId}: probability ${outcome.probability.toFixed(3)}, ${outcome.outcome}, ${outcome.disposition}`;
}

function renderFixture(fixture: EvaluationFixtureOutcome): string[] {
    const lines: string[] = [];
    const expectation =
        fixture.expected.concern === 'none' ? 'expected no concern' : `expected concern ${fixture.expected.concern}`;
    lines.push(`${fixture.fixtureId} (${fixture.kind}, ${expectation})`);
    lines.push(`  path      ${fixture.path}`);
    lines.push(`  rule      ${fixture.ruleId}`);
    lines.push(`  source    ${fixture.sourceKind}; execution ${fixture.execution}`);
    lines.push(
        `  model     requested ${fixture.requestedModel}; returned ${
            fixture.returnedModels.length === 0 ? 'none' : fixture.returnedModels.join(', ')
        }`
    );
    lines.push(`  asked     ${renderRuleList(fixture.rulesAsked)}`);
    lines.push(`  unasked   ${renderNotAsked(fixture.rulesNotAsked)}`);
    lines.push(`  evidence  ${fixture.evidenceSupplied.length === 0 ? 'none' : fixture.evidenceSupplied.join(', ')}`);
    lines.push(`  thresholds ${renderThresholds(fixture.thresholds)}`);
    lines.push(
        `  facts     ${
            fixture.factsCarried === undefined
                ? 'no request carried a fact block'
                : `${JSON.stringify(fixture.factsCarried)} (matches corpus: ${String(fixture.factsMatchCorpus)})`
        }`
    );
    for (const outcome of fixture.outcomes) {
        lines.push(`  outcome   ${renderOutcome(outcome)}`);
    }
    if (fixture.otherSignals.length > 0) {
        lines.push(`  other signals ${renderRuleList(fixture.otherSignals)}`);
    }
    lines.push(
        `  verdict   ${
            fixture.expectedConcernHeld
                ? 'the labelled expectation held'
                : 'the labelled expectation did NOT hold (an unasked question counts as not held)'
        }`
    );
    if (fixture.failureCode !== undefined) {
        lines.push(`  failure   ${fixture.failureCode}`);
    }
    for (const limitation of fixture.limitations) {
        lines.push(`  limitation ${limitation}`);
    }
    return lines;
}

/**
 * The exact bytes the outcome file holds: the result itself, with its `outcomes` array at the top level.
 *
 * This is the shape the measurement reader reads — `readEvaluationOutcome` documents the runner's file as
 * its `SemanticEvaluationResult`, or the fixture array itself — so the writer and the reader agree on one
 * contract rather than the writer wrapping the result in an envelope nothing else unwrapped. The reader
 * validates every field it needs and refuses by name, which is what makes a shape change visible here.
 */
export function serializeEvaluationOutcomes(result: SemanticEvaluationResult): string {
    return `${JSON.stringify(result, null, 4)}\n`;
}

/** The runner's report: every fixture's request content and raw outcome, and nothing that reads as a verdict. */
export function renderEvaluation(result: SemanticEvaluationResult): string {
    const header = [
        `semantic evaluation: ${String(result.outcomes.length)} fixture(s), ${String(result.providerRequests)} provider request(s), ${String(result.signals)} fired signal(s), ${String(result.expectationsHeld)}/${String(result.outcomes.length)} labelled expectations held`,
        'advisory only: these outcomes are evidence about the provider and the rules, never about a change',
    ];
    const body = result.outcomes.flatMap((outcome) => ['', ...renderFixture(outcome)]);
    return [...header, ...body].join('\n');
}
