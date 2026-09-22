/**
 * The versioned, runtime-validated report and its deterministic human summary.
 *
 * Validation runs before interpretation and again at any publication boundary: an unknown schema
 * version, an invalid identity, an out-of-range probability, an unknown evidence id, or an
 * inconsistent count is refused rather than rendered. The summary is generated from the report, never
 * written by a model, and it never claims that a scope is safe, approved, or all clear.
 */

import {
    assertAdvisoryWording,
    computeContextDigest,
    assertDigest,
    assertFullSha,
    assertLineRange,
    assertNonEmptyString,
    isSemanticFailureCode,
    refuse,
    SEMANTIC_REPORT_FORMAT,
    type SemanticExecutionState,
    type SemanticPublicationState,
    type SemanticRevisionContext,
    type SemanticScopeExclusion,
} from './contracts.ts';
import { SCAN_OUTCOMES, type SemanticRuleId } from './rules.ts';

import type { FindingAssessment, ScanAssessment } from './interpret.ts';

export const SEMANTIC_MODES = ['scan', 'verify'] as const;
export type SemanticMode = (typeof SEMANTIC_MODES)[number];

export const MAX_SUMMARY_ITEMS = 5;

export type SemanticScopeReport = {
    readonly discovered: number;
    readonly eligible: number;
    readonly assessed: number;
    readonly cacheHits: number;
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly unassessed: readonly SemanticScopeExclusion[];
    readonly truncated: readonly SemanticScopeExclusion[];
};

export type SemanticUsageReport = {
    readonly networkAttempts: number;
    readonly logicalRequests: number;
    readonly retries: number;
    readonly submittedBytes: number;
    readonly actualInputTokens: number;
    readonly estimatedInputTokens: number;
    readonly attemptsWithUnknownUsage: number;
    readonly estimatedCostUsd: number;
    readonly pricingConfigurationVersion: string;
};

export type SemanticPublicationReport = {
    readonly state: SemanticPublicationState;
    readonly checkId?: string;
};

type SemanticReportBase = {
    readonly schemaVersion: typeof SEMANTIC_REPORT_FORMAT;
    readonly runId: string;
    readonly context: SemanticRevisionContext;
    readonly requestedModel: string;
    readonly returnedModels: readonly string[];
    readonly sdkVersion: string;
    readonly rulesDigest: string;
    /** The policy actually applied, which a `replay` may differ from the one that produced the answers. */
    readonly policyDigest: string;
    readonly policyVersion: string;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly execution: SemanticExecutionState;
    readonly scope: SemanticScopeReport;
    readonly limitations: readonly string[];
    readonly usage: SemanticUsageReport;
    readonly publication: SemanticPublicationReport;
    readonly failureCode?: string;
};

export type SemanticScanReport = SemanticReportBase & {
    readonly mode: 'scan';
    readonly signals: readonly ScanAssessment[];
};

export type SemanticVerifyReport = SemanticReportBase & {
    readonly mode: 'verify';
    readonly findingAssessments: readonly FindingAssessment[];
};

export type SemanticReport = SemanticScanReport | SemanticVerifyReport;

/** Counts must agree in both directions: excluded paths are exactly the ineligible ones. */
export function assertScopeConsistency(scope: SemanticScopeReport, label: string): void {
    const counts = [scope.discovered, scope.eligible, scope.assessed, scope.cacheHits];
    if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
        refuse('invalid_response', `${label} scope counts must be non-negative safe integers`);
    }
    if (scope.eligible + scope.excluded.length !== scope.discovered) {
        refuse(
            'invalid_response',
            `${label} scope is inconsistent: ${String(scope.eligible)} eligible plus ${String(scope.excluded.length)} excluded is not ${String(scope.discovered)} discovered`
        );
    }
    if (scope.assessed + scope.unassessed.length !== scope.eligible) {
        refuse(
            'invalid_response',
            `${label} scope is inconsistent: ${String(scope.assessed)} assessed plus ${String(scope.unassessed.length)} unassessed is not ${String(scope.eligible)} eligible`
        );
    }
    if (scope.cacheHits > scope.assessed) {
        refuse('invalid_response', `${label} reports more cache hits than assessed units`);
    }
}

function readNonNegativeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        refuse('invalid_response', `${label} must be a non-negative safe integer`);
    }
    return value as number;
}

function readStringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an array`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== 'string') {
            refuse('invalid_response', `${label}[${String(index)}] must be a string`);
        }
        return entry;
    });
}

function readExclusions(value: unknown, label: string): SemanticScopeExclusion[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an array`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            refuse('invalid_response', `${label}[${String(index)}] must be an object`);
        }
        const record = entry as Record<string, unknown>;
        return {
            path: assertNonEmptyString(record.path, `${label}[${String(index)}].path`),
            reason: assertNonEmptyString(record.reason, `${label}[${String(index)}].reason`),
        };
    });
}

function readRevisionContext(value: unknown, label: string): SemanticRevisionContext {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const prNumber =
        record.prNumber === undefined ? undefined : readNonNegativeInteger(record.prNumber, `${label}.prNumber`);
    return {
        repository: assertNonEmptyString(record.repository, `${label}.repository`),
        repositoryId: assertNonEmptyString(record.repositoryId, `${label}.repositoryId`),
        prNumber,
        headSha: assertFullSha(record.headSha, `${label}.headSha`),
        targetBaseSha: assertFullSha(record.targetBaseSha, `${label}.targetBaseSha`),
        mergeBaseSha: assertFullSha(record.mergeBaseSha, `${label}.mergeBaseSha`),
        trustedExecutionSha: assertFullSha(record.trustedExecutionSha, `${label}.trustedExecutionSha`),
        contractSourceSha: assertFullSha(record.contractSourceSha, `${label}.contractSourceSha`),
        evidenceProfile: assertNonEmptyString(record.evidenceProfile, `${label}.evidenceProfile`),
        rulesDigest: assertDigest(record.rulesDigest, `${label}.rulesDigest`),
        policyVersion: assertNonEmptyString(record.policyVersion, `${label}.policyVersion`),
        contextDigest: assertDigest(record.contextDigest, `${label}.contextDigest`),
    };
}

/**
 * Validates a report from any source. This is the boundary that makes an untrusted or stale report
 * unusable as current advice: it refuses an unknown schema, a malformed identity, a bad enum, an
 * out-of-range probability, an unknown evidence id, and inconsistent counts.
 */
/**
 * The recorded identity must name the revision and policy that produced the report.
 *
 * Without this the content-addressed identity is decorative: a forged or hand-edited report validates,
 * and — because the sidecar directory is keyed on `contextDigest` — a report could be replayed under
 * another revision's name. Recomputing here is what makes validation the boundary it claims to be.
 */
/**
 * Every way a report can name an identity it cannot support: a context digest that does not match its
 * own context, a top-level identity that disagrees with the context's copy of it, or a failure
 * recorded beside a completed execution.
 */
function assertIdentityAgrees(base: SemanticReportBase): void {
    assertContextIsSelfConsistent(base.context);
    if (base.rulesDigest !== base.context.rulesDigest) {
        refuse('invalid_response', 'semantic report rulesDigest disagrees with its revision context');
    }
    if (base.policyVersion !== base.context.policyVersion) {
        refuse('invalid_response', 'semantic report policyVersion disagrees with its revision context');
    }
    if (base.failureCode !== undefined && (base.execution === 'completed' || base.execution === 'skipped')) {
        refuse(
            'invalid_response',
            `semantic report records execution ${base.execution} together with failure ${base.failureCode}`
        );
    }
}

function assertContextIsSelfConsistent(context: SemanticRevisionContext): void {
    const expected = computeContextDigest({
        repository: context.repository,
        repositoryId: context.repositoryId,
        prNumber: context.prNumber,
        headSha: context.headSha,
        targetBaseSha: context.targetBaseSha,
        mergeBaseSha: context.mergeBaseSha,
        trustedExecutionSha: context.trustedExecutionSha,
        contractSourceSha: context.contractSourceSha,
        evidenceProfile: context.evidenceProfile,
        rulesDigest: context.rulesDigest,
        policyVersion: context.policyVersion,
    });
    if (expected !== context.contextDigest) {
        refuse(
            'invalid_response',
            'semantic report contextDigest does not match its own revision context; the report names an identity it cannot support'
        );
    }
}

/**
 * Truncated or unassessed evidence means the scope was not fully assessed, so `completed` and either
 * of those cannot both be true of the same run. The exit code branches on the execution state, so a
 * report claiming completion here would have told a consumer that nothing was left unread.
 */
function assertExecutionMatchesScope(execution: unknown, scope: SemanticScopeReport, mode: SemanticMode): void {
    if (execution !== 'completed') {
        return;
    }
    if (scope.truncated.length === 0 && scope.unassessed.length === 0) {
        return;
    }
    refuse(
        'invalid_response',
        `semantic report claims completed execution while ${String(scope.truncated.length)} region(s) were truncated and ${String(scope.unassessed.length)} ${assessedNoun(mode)}(s) were unassessed`
    );
}

export function validateReport(value: unknown): SemanticReport {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', 'semantic report must be an object');
    }
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== SEMANTIC_REPORT_FORMAT) {
        refuse('invalid_response', `semantic report schemaVersion must be ${SEMANTIC_REPORT_FORMAT}`);
    }
    if (record.mode !== 'scan' && record.mode !== 'verify') {
        refuse('invalid_response', 'semantic report mode must be scan or verify');
    }
    if (!isExecutionState(record.execution)) {
        refuse('invalid_response', 'semantic report execution state is not a known value');
    }
    if (typeof record.publication !== 'object' || record.publication === null) {
        refuse('invalid_response', 'semantic report publication must be an object');
    }
    const publication = record.publication as Record<string, unknown>;
    if (!PUBLICATION_STATE_SET.has(publication.state as string)) {
        refuse('invalid_response', 'semantic report publication state is not a known value');
    }
    if (typeof record.scope !== 'object' || record.scope === null) {
        refuse('invalid_response', 'semantic report scope must be an object');
    }
    const rawScope = record.scope as Record<string, unknown>;
    const scope: SemanticScopeReport = {
        discovered: readNonNegativeInteger(rawScope.discovered, 'scope.discovered'),
        eligible: readNonNegativeInteger(rawScope.eligible, 'scope.eligible'),
        assessed: readNonNegativeInteger(rawScope.assessed, 'scope.assessed'),
        cacheHits: readNonNegativeInteger(rawScope.cacheHits, 'scope.cacheHits'),
        excluded: readExclusions(rawScope.excluded, 'scope.excluded'),
        unassessed: readExclusions(rawScope.unassessed, 'scope.unassessed'),
        truncated: readExclusions(rawScope.truncated, 'scope.truncated'),
    };
    assertScopeConsistency(scope, 'semantic report');
    assertExecutionMatchesScope(record.execution, scope, record.mode);

    if (typeof record.usage !== 'object' || record.usage === null) {
        refuse('invalid_response', 'semantic report usage must be an object');
    }
    const rawUsage = record.usage as Record<string, unknown>;
    const rawCost = rawUsage.estimatedCostUsd;
    if (typeof rawCost !== 'number' || !Number.isFinite(rawCost)) {
        refuse('invalid_response', 'usage.estimatedCostUsd must be a finite number');
    }
    const usage: SemanticUsageReport = {
        networkAttempts: readNonNegativeInteger(rawUsage.networkAttempts, 'usage.networkAttempts'),
        logicalRequests: readNonNegativeInteger(rawUsage.logicalRequests, 'usage.logicalRequests'),
        retries: readNonNegativeInteger(rawUsage.retries, 'usage.retries'),
        submittedBytes: readNonNegativeInteger(rawUsage.submittedBytes, 'usage.submittedBytes'),
        actualInputTokens: readNonNegativeInteger(rawUsage.actualInputTokens, 'usage.actualInputTokens'),
        estimatedInputTokens: readNonNegativeInteger(rawUsage.estimatedInputTokens, 'usage.estimatedInputTokens'),
        attemptsWithUnknownUsage: readNonNegativeInteger(
            rawUsage.attemptsWithUnknownUsage,
            'usage.attemptsWithUnknownUsage'
        ),
        estimatedCostUsd: rawCost,
        pricingConfigurationVersion: assertNonEmptyString(
            rawUsage.pricingConfigurationVersion,
            'usage.pricingConfigurationVersion'
        ),
    };

    let publicationCheckId: string | undefined;
    if (publication.checkId !== undefined) {
        publicationCheckId = assertNonEmptyString(publication.checkId, 'publication.checkId');
    }

    const base: SemanticReportBase = {
        schemaVersion: SEMANTIC_REPORT_FORMAT,
        runId: assertNonEmptyString(record.runId, 'report.runId'),
        context: readRevisionContext(record.context, 'report.context'),
        requestedModel: assertNonEmptyString(record.requestedModel, 'report.requestedModel'),
        returnedModels: readStringArray(record.returnedModels, 'report.returnedModels'),
        sdkVersion: assertNonEmptyString(record.sdkVersion, 'report.sdkVersion'),
        rulesDigest: assertDigest(record.rulesDigest, 'report.rulesDigest'),
        policyDigest: assertDigest(record.policyDigest, 'report.policyDigest'),
        policyVersion: assertNonEmptyString(record.policyVersion, 'report.policyVersion'),
        startedAt: assertNonEmptyString(record.startedAt, 'report.startedAt'),
        completedAt: assertNonEmptyString(record.completedAt, 'report.completedAt'),
        execution: record.execution,
        scope,
        limitations: readStringArray(record.limitations, 'report.limitations'),
        usage,
        publication: { state: publication.state as SemanticPublicationState, checkId: publicationCheckId },
        failureCode: isSemanticFailureCode(record.failureCode) ? record.failureCode : undefined,
    };

    assertIdentityAgrees(base);

    if (record.mode === 'scan') {
        return { ...base, mode: 'scan', signals: readScanAssessments(record.signals) };
    }
    return { ...base, mode: 'verify', findingAssessments: readFindingAssessments(record.findingAssessments) };
}

const PUBLICATION_STATE_SET: ReadonlySet<string> = new Set(['not_requested', 'published', 'stale', 'failed']);
const EXECUTION_STATE_SET: ReadonlySet<string> = new Set([
    'completed',
    'partial',
    'unavailable',
    'cancelled',
    'skipped',
]);
const SCAN_OUTCOME_SET: ReadonlySet<string> = new Set(SCAN_OUTCOMES);

function isExecutionState(value: unknown): value is SemanticExecutionState {
    return typeof value === 'string' && EXECUTION_STATE_SET.has(value);
}

function readProbabilities<Label extends string>(
    value: unknown,
    labels: readonly Label[],
    label: string
): Record<Label, number> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const probabilities = {} as Record<Label, number>;
    for (const name of labels) {
        const entry = record[name];
        if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 1) {
            refuse('invalid_response', `${label}.${name} must be a finite probability in [0, 1]`);
        }
        probabilities[name] = entry;
    }
    return probabilities;
}

function readScanAssessments(value: unknown): ScanAssessment[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', 'scan report signals must be an array');
    }
    return value.map((entry, index) => {
        const label = `signals[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null) {
            refuse('invalid_response', `${label} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (!SCAN_OUTCOME_SET.has(record.outcome as string)) {
            refuse('invalid_response', `${label}.outcome is not a known scan outcome`);
        }
        if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) {
            refuse('invalid_response', `${label}.confidence must be a finite number`);
        }
        if (typeof record.probability !== 'number' || !Number.isFinite(record.probability)) {
            refuse('invalid_response', `${label}.probability must be a finite number`);
        }
        if (record.probability < 0 || record.probability > 1) {
            refuse('invalid_response', `${label}.probability must be in [0, 1]`);
        }
        return {
            ruleId: assertNonEmptyString(record.ruleId, `${label}.ruleId`) as SemanticRuleId,
            unitId: assertNonEmptyString(record.unitId, `${label}.unitId`),
            path: assertNonEmptyString(record.path, `${label}.path`),
            outcome: record.outcome as ScanAssessment['outcome'],
            probability: record.probability,
            confidence: record.confidence,
            disposition: assertNonEmptyString(
                record.disposition,
                `${label}.disposition`
            ) as ScanAssessment['disposition'],
            investigationCategory: assertNonEmptyString(
                record.investigationCategory,
                `${label}.investigationCategory`
            ) as ScanAssessment['investigationCategory'],
            missingEvidence: readStringArray(record.missingEvidence, `${label}.missingEvidence`),
            reasoning: assertNonEmptyString(record.reasoning, `${label}.reasoning`),
        };
    });
}

function readFindingAssessments(value: unknown): FindingAssessment[] {
    if (!Array.isArray(value)) {
        refuse('invalid_response', 'verify report findingAssessments must be an array');
    }
    return value.map((entry, index) => {
        const label = `findingAssessments[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null) {
            refuse('invalid_response', `${label} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.escalate !== 'boolean') {
            refuse('invalid_response', `${label}.escalate must be a boolean`);
        }
        return {
            findingId: assertNonEmptyString(record.findingId, `${label}.findingId`),
            support: readAssessmentPart(
                record.support,
                ['supported', 'contradicted', 'insufficient_context'],
                `${label}.support`
            ),
            attribution: readAssessmentPart(
                record.attribution,
                ['introduced_by_change', 'pre_existing', 'undetermined'],
                `${label}.attribution`
            ),
            kind: readAssessmentPart(
                record.kind,
                ['behavioral_or_contract_issue', 'style_preference', 'undetermined'],
                `${label}.kind`
            ),
            disposition: assertNonEmptyString(
                record.disposition,
                `${label}.disposition`
            ) as FindingAssessment['disposition'],
            escalate: record.escalate,
            strongestEvidenceIds: readStringArray(record.strongestEvidenceIds, `${label}.strongestEvidenceIds`),
            reasoning: assertNonEmptyString(record.reasoning, `${label}.reasoning`),
        };
    });
}

function readAssessmentPart<Outcome extends string>(
    value: unknown,
    labels: readonly Outcome[],
    label: string
): { outcome: Outcome; probabilities: Record<Outcome, number>; confidence: number } {
    if (typeof value !== 'object' || value === null) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) {
        refuse('invalid_response', `${label}.confidence must be a finite number`);
    }
    const known: readonly string[] = labels;
    if (!known.includes(record.outcome as string)) {
        refuse('invalid_response', `${label}.outcome is not a known value`);
    }
    return {
        outcome: record.outcome as Outcome,
        probabilities: readProbabilities(record.probabilities, labels, `${label}.probabilities`),
        confidence: record.confidence,
    };
}

/**
 * The deterministic human summary. At most five primary items are shown; the remainder stay in the
 * structured report and only their count is printed. Full probability tables are never printed.
 */
/** The omitted-item count line, or an empty string when nothing was omitted. */
function omittedLine(total: number): string {
    if (total <= MAX_SUMMARY_ITEMS) {
        return '';
    }
    return `  (${String(total - MAX_SUMMARY_ITEMS)} more in the structured report)`;
}

/**
 * An answer at or above this and below its fire threshold came close without reaching it. It is a
 * reading of the reported probabilities, not a disposition: no property is marked undecided, and the
 * summary says what happened instead of leaving a reader to assume the questions were answered.
 */
const NEAR_MISS_PROBABILITY = 0.5;

/**
 * The assessed count and how many of those were not decisive, read per mode. In scan mode an answer
 * below its fire threshold is simply not flagged, but a run whose answers all sat near the threshold
 * established nothing, so near misses are counted from the values themselves while
 * `insufficient_context` stays reserved for evidence the application knows it never sent. In verify
 * mode `needs_more_evidence` is a coverage gap — evidence never supplied — or a genuinely non-decisive
 * assessment, never a near miss.
 */
function outcomeCounts(report: SemanticReport): { totalAssessments: number; undecided: number } {
    if (report.mode === 'scan') {
        return {
            totalAssessments: report.signals.length,
            undecided:
                report.signals.filter((signal) => signal.disposition === 'unresolved').length +
                report.signals.filter(
                    (signal) =>
                        signal.disposition === 'no_additional_recommendation' &&
                        signal.probability >= NEAR_MISS_PROBABILITY
                ).length,
        };
    }
    return {
        totalAssessments: report.findingAssessments.length,
        undecided: report.findingAssessments.filter((assessment) => assessment.disposition === 'needs_more_evidence')
            .length,
    };
}

/**
 * The one sentence that says how the run went. `unresolved` is a first-class scan disposition and a
 * verify report's `needs_more_evidence` is a coverage gap, so a run in which the model declined every
 * question — or every finding's evidence was withheld — must not read the same as one it answered
 * cleanly. Each mode words its own undecided branch from what that mode actually carries.
 */
function describeOutcome(input: {
    mode: SemanticMode;
    assessed: number;
    actionableCount: number;
    totalAssessments: number;
    undecided: number;
    execution: SemanticExecutionState;
}): string {
    const noun = assessedNoun(input.mode);
    if (input.assessed === 0) {
        return `No ${noun} was assessed; this report carries no semantic signal.`;
    }
    if (input.actionableCount > 0) {
        return `${String(input.actionableCount)} item(s) for the orchestrator to weigh:`;
    }
    if (input.totalAssessments > 0 && input.undecided === input.totalAssessments) {
        if (input.mode === 'verify') {
            return `No finding was decidable in ${String(input.assessed)} evaluated finding(s): all ${String(input.totalAssessments)} needed more evidence. No semantic signal was established.`;
        }
        return `No question was decidable in ${String(input.assessed)} evaluated unit(s): all ${String(input.totalAssessments)} question(s) were unresolved or came close to their threshold without reaching it. No semantic signal was established.`;
    }
    if (input.undecided > 0) {
        if (input.mode === 'verify') {
            // A verify report's `needs_more_evidence` disposition means the required evidence was not
            // supplied or was not decisive, not that the model wavered around a threshold. Naming it
            // "unresolved or close to a threshold" would present withheld evidence as model indecision.
            return `Assessed without a decisive answer: ${String(input.undecided)} of ${String(input.totalAssessments)} finding(s) needed more evidence in ${String(input.assessed)} evaluated finding(s).`;
        }
        // `undecided` counts genuine `unresolved` dispositions and near misses together, so the
        // sentence must name both: calling a near miss "unresolved" contradicts the report's own
        // dispositions, where the near miss is a `no_additional_recommendation` answer below its fire
        // threshold.
        return `Assessed without a decisive answer: ${String(input.undecided)} of ${String(input.totalAssessments)} question(s) were unresolved or came close to their threshold without reaching it in ${String(input.assessed)} evaluated unit(s).`;
    }
    if (input.execution !== 'completed') {
        // A run whose own header reads `partial` must never print the completion sentence, even when
        // every answer it did receive was decisive: the missing evidence is the whole point.
        return `No additional semantic signals in ${String(input.assessed)} evaluated ${noun}(s), but the run did not supply all its evidence.`;
    }
    return `Completed: no additional semantic signals in ${String(input.assessed)} evaluated ${noun}(s).`;
}

/**
 * The noun a mode's summary uses for the assessed scope: scan counts units, verify counts findings.
 * Every branch of `describeOutcome` reads it, so the two modes cannot word one branch the other
 * mode's way.
 */
function assessedNoun(mode: SemanticMode): string {
    if (mode === 'verify') {
        return 'finding';
    }
    return 'unit';
}

export function renderSummary(report: SemanticReport): string {
    const lines: string[] = [];
    // The advisory-wording guard governs this application's own claims, and it is applied to these
    // lines alone. A summary also carries repository-controlled text — path names, model-selected
    // actionables, limitation text quoting a path — and scanning that text for words like "approved"
    // made a change to `src/modules/Approved/…` throw before its report was written, discarding a
    // paid assessment and reporting no coverage for a run that produced advice. A path name is not a
    // claim about safety; a sentence this application composes is.
    const claims: string[] = [];
    const claim = (line: string): void => {
        lines.push(line);
        claims.push(line);
    };
    const context = report.context;
    claim(`Semantic review (${report.mode}) — ${report.execution}`);
    lines.push(
        `head ${context.headSha.slice(0, 12)} · merge base ${context.mergeBaseSha.slice(0, 12)} · target base ${context.targetBaseSha.slice(0, 12)}`
    );
    lines.push(
        `scope: ${String(report.scope.assessed)} of ${String(report.scope.eligible)} eligible ${assessedNoun(report.mode)}(s) assessed (${String(report.scope.discovered)} discovered)`
    );
    // The policy is named because a replay may apply a different one than produced the answers.
    lines.push(
        `questions ${report.rulesDigest.slice(0, 12)} · policy ${report.policyDigest.slice(0, 12)} (${report.policyVersion})`
    );

    const { totalAssessments, undecided } = outcomeCounts(report);

    const actionableLines: string[] = [];
    if (report.mode === 'scan') {
        const signals = report.signals.filter((signal) => signal.disposition === 'recommend_investigation');
        for (const signal of signals.slice(0, MAX_SUMMARY_ITEMS)) {
            actionableLines.push(
                `  - [${signal.investigationCategory}] ${signal.path} (${signal.ruleId}) — ${signal.reasoning}`
            );
        }
        actionableLines.push(omittedLine(signals.length));
    } else {
        const disputedOrReady = report.findingAssessments.filter(
            (assessment) =>
                assessment.disposition === 'ready_for_orchestrator_validation' || assessment.disposition === 'disputed'
        );
        for (const assessment of disputedOrReady.slice(0, MAX_SUMMARY_ITEMS)) {
            const escalated = assessment.escalate ? ' [severe: keep visible]' : '';
            actionableLines.push(
                `  - ${assessment.findingId} → ${assessment.disposition}${escalated} — ${assessment.reasoning}`
            );
        }
        actionableLines.push(omittedLine(disputedOrReady.length));
    }
    const actionableCount = actionableLines.filter((line) => line.startsWith('  - ')).length;

    claim(
        describeOutcome({
            mode: report.mode,
            assessed: report.scope.assessed,
            actionableCount,
            totalAssessments,
            undecided,
            execution: report.execution,
        })
    );
    if (actionableCount > 0) {
        for (const line of actionableLines) {
            if (line !== '') {
                lines.push(line);
            }
        }
    }

    const unresolved = report.scope.unassessed.length + report.scope.truncated.length;
    if (unresolved > 0) {
        claim(
            `Incomplete: ${String(report.scope.unassessed.length)} ${assessedNoun(report.mode)}(s) unassessed and ${String(report.scope.truncated.length)} region(s) truncated or withheld.`
        );
        for (const entry of report.scope.unassessed.slice(0, MAX_SUMMARY_ITEMS)) {
            lines.push(`  - not assessed: ${entry.path} (${entry.reason})`);
        }
    }
    for (const limitation of report.limitations.slice(0, MAX_SUMMARY_ITEMS)) {
        lines.push(`  - limitation: ${limitation}`);
    }

    lines.push(
        `usage: ${String(report.usage.networkAttempts)} network attempt(s), ${String(report.usage.retries)} retr(ies), ${String(report.scope.cacheHits)} cache hit(s), ${String(report.usage.actualInputTokens)} input token(s), ~$${report.usage.estimatedCostUsd.toFixed(4)} (${report.usage.pricingConfigurationVersion})`
    );
    if (report.usage.attemptsWithUnknownUsage > 0) {
        claim(
            `  - ${String(report.usage.attemptsWithUnknownUsage)} attempt(s) have unknown usage; their cost is not included`
        );
    }
    if (!context.headSha || report.failureCode !== undefined) {
        claim(`failure: ${report.failureCode ?? 'unknown'}`);
    }

    const summary = lines.join('\n');
    assertAdvisoryWording(claims.join('\n'));
    return summary;
}

/** Serializes a report deterministically, so the same assessment renders the same bytes. */
export function serializeReport(report: SemanticReport): string {
    return `${JSON.stringify(report, null, 4)}\n`;
}

export function parseReportJson(text: string, label: string): SemanticReport {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch (error) {
        refuse(
            'invalid_response',
            `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return validateReport(parsed);
}

export { assertLineRange };
