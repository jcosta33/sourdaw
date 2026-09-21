/**
 * Scan and verify orchestration.
 *
 * Application code owns the scope, the budgets, the routing, and the report. Independent questions that
 * share a unit's evidence are batched into one request, because questions in one request are mutually
 * blind and cannot build on each other's answers. A genuinely dependent decision would need a later
 * stage; nothing here has one.
 *
 * Every operational failure becomes a report with an explicit execution state rather than an
 * exception: an unavailable provider must never block the delivery path, and it must never produce a
 * clean-review claim either.
 */

import {
    buildRevisionContext,
    NO_EVIDENCE_ID,
    refuse,
    SEMANTIC_POLICY_VERSION,
    SEMANTIC_REPORT_FORMAT,
    type EvidenceReference,
    type SemanticRevisionBase,
    type SemanticScopeExclusion,
} from './contracts.ts';
import {
    assertEvidenceIntegrity,
    collectEvidence,
    compareByPath,
    exclusionReason,
    type SemanticEvidenceLimits,
    type SemanticEvidenceSet,
    type SemanticChangedFile,
    type SemanticSourcePort,
} from './evidence.ts';
import { fitUnitEvidence, serializedRegion } from './fit.ts';
import { interpretScanOutcome, type ScanAssessment } from './interpret.ts';
import {
    assessUnit,
    createBudgetController,
    estimateCost,
    estimateInputTokens,
    TYPESAFE_MODEL,
    TYPESAFE_SDK_VERSION_FOR_CACHE,
    type SemanticBudgetController,
    type SemanticCachePort,
    type SemanticProviderPort,
    type SemanticUsageTotals,
} from './provider.ts';
import { type SemanticScanReport, type SemanticScopeReport, type SemanticUsageReport } from './report.ts';
import {
    applicableRules,
    computePolicyDigest,
    computeRulesDigest,
    isTestPath,
    type SemanticBudgetProfile,
    type SemanticRule,
    type SemanticRuleId,
} from './rules.ts';

export type SemanticClock = { readonly now: () => number };

export type SemanticPorts = {
    readonly source: SemanticSourcePort;
    readonly provider: SemanticProviderPort;
    readonly cache: SemanticCachePort;
    readonly clock: SemanticClock;
    readonly signal: AbortSignal;
    readonly log: (message: string) => void;
};

export type SemanticRequestPreview = {
    readonly unitId: string;
    readonly path: string;
    readonly ruleIds: readonly SemanticRuleId[];
    readonly evidenceIds: readonly string[];
    readonly bodyBytes: number;
    readonly estimatedInputTokens: number;
};

export type SemanticUnitPlan = {
    readonly unitId: string;
    readonly path: string;
    readonly file: SemanticChangedFile;
    readonly rules: readonly SemanticRule[];
    readonly evidence: SemanticEvidenceSet;
};

/**
 * The exclusion reasons that mean nothing was owed for this path: no rule applies to it, or the
 * collector decided it needs no reading at all — generated, a lockfile, binary, or unchanged text.
 *
 * The complement is what turns an empty scope into "an assessment was never produced". A lockfile-only
 * change is the same class as a documentation-only one and must stay a skip; reading every
 * non-`no-applicable-rule` reason as a missed assessment turned it into a red check claiming a
 * coverage gap that does not exist.
 */
const NOTHING_OWED_EXCLUSION_REASONS: ReadonlySet<string> = new Set([
    'no-applicable-rule',
    'generated',
    'dependency-lockfile',
    'binary',
    'no-text-change',
]);

/** Whether an exclusion means an assessment was owed for that path and not produced. */
export function isMissedAssessmentExclusion(reason: string): boolean {
    return !NOTHING_OWED_EXCLUSION_REASONS.has(reason);
}

/** Required-evidence vocabulary mapped to a deterministic predicate over the supplied regions. */
function requiredEvidencePresent(token: string, references: readonly EvidenceReference[]): boolean {
    const lower = token.toLowerCase();
    // A region cut to a prefix does not answer for the whole side it came from, so it cannot satisfy
    // a required side on its own: a rule told it has the after side while holding 6% of it would
    // score evidence it never saw.
    const has = (side: EvidenceReference['side']): boolean => references.some((reference) => reference.side === side);
    // Implementation source is a claim about *which* after side, not merely that one exists. Resolving
    // it to `has('after')` let a test unit's own region satisfy a rule that declared it needed the
    // implementation, so the rule scored a question it never had the evidence to answer — and this
    // branch has to come before the generic `after` one for that resolution to mean anything.
    if (lower.includes('implementation')) {
        return references.some((reference) => reference.side === 'after' && !isTestPath(reference.path));
    }
    if (lower.includes('before')) {
        return has('before');
    }
    if (lower.includes('after')) {
        return has('after');
    }
    if (lower.includes('contract') || lower.includes('decision') || lower.includes('registration')) {
        return has('context');
    }
    if (lower.includes('call-site') || lower.includes('caller') || lower.includes('scheduling')) {
        return has('context') || has('after');
    }
    return references.length > 0;
}

/**
 * The rule's required evidence that is genuinely absent.
 *
 * A side that cannot exist for this change is not missing. An added file has no before side, so a
 * rule about removing previously-checked behavior has nothing to compare against and must not be
 * reported incomplete for evidence the change could not have produced; the same holds for the after
 * side of a deletion.
 */
export function missingRequiredEvidence(
    rule: SemanticRule,
    references: readonly EvidenceReference[],
    kind: SemanticChangedFile['kind'] = 'modified'
): string[] {
    return rule.requiredEvidence.filter((token) => {
        const lower = token.toLowerCase();
        if (kind === 'added' && lower.includes('before')) {
            return false;
        }
        if (kind === 'deleted' && lower.includes('after')) {
            return false;
        }
        return !requiredEvidencePresent(token, references);
    });
}

function evidenceForPath(
    set: SemanticEvidenceSet,
    path: string,
    previousPath: string | undefined
): EvidenceReference[] {
    return set.references.filter((reference) => {
        if (reference.side === 'context') {
            return false;
        }
        return reference.path === path || (previousPath !== undefined && reference.path === previousPath);
    });
}

/**
 * Plans one unit per eligible changed file. A unit carries the rules whose applicability predicate
 * admits that path, and the context regions those rules require.
 */
export function planUnits(
    files: readonly SemanticChangedFile[],
    set: SemanticEvidenceSet,
    maxStatePlusQuestionBytes: number
): { units: SemanticUnitPlan[]; excluded: SemanticScopeExclusion[]; incomplete: SemanticScopeExclusion[] } {
    const units: SemanticUnitPlan[] = [];
    const excluded: SemanticScopeExclusion[] = [...set.excluded];
    const excludedPaths = new Set(excluded.map((entry) => entry.path));
    // A path the fitter had to drop is evidence that never left the machine, so it belongs in the
    // incomplete bucket the completion decision reads, not only in the excluded list.
    const incomplete: SemanticScopeExclusion[] = [];
    const sorted = [...files].sort(compareByPath);

    for (const file of sorted) {
        const reason = exclusionReason(file);
        if (reason !== undefined) {
            continue;
        }
        // Collection may already have excluded this path — a withheld credential on one side. It is
        // then not eligible: counting it as both excluded and planned breaks the manifest arithmetic
        // and, worse, would assess a file whose other side never left the machine.
        if (excludedPaths.has(file.path)) {
            continue;
        }
        const rules = applicableRules([file.path]);
        if (rules.length === 0) {
            excluded.push({ path: file.path, reason: 'no-applicable-rule' });
            continue;
        }
        const own = evidenceForPath(set, file.path, file.previousPath);
        if (own.length === 0) {
            // Context regions alone would otherwise make a wholly-withheld file count as assessed.
            // One exclusion per path: collection may already have excluded it, and a second entry
            // would break the manifest's own arithmetic.
            if (!excludedPaths.has(file.path)) {
                excluded.push({ path: file.path, reason: 'no-admissible-evidence' });
            }
            continue;
        }
        const needsContract = rules.some((rule) =>
            rule.requiredEvidence.some((token) => /contract|decision|registration/iu.test(token))
        );
        // A rule that declares it needs the implementation is asking about a path that is usually not
        // the one under assessment, so the planner supplies the changed implementation's after side as
        // context. Without this the declaration was unsatisfiable and the rule silently scored anyway;
        // with it, a change whose implementation is unchanged reports the evidence as missing.
        const needsImplementation = rules.some((rule) =>
            rule.requiredEvidence.some((token) => /implementation/iu.test(token))
        );
        let context: EvidenceReference[] = [];
        if (needsContract) {
            context = set.references.filter((reference) => reference.side === 'context');
        }
        if (needsImplementation) {
            context = context.concat(
                set.references.filter(
                    (reference) =>
                        reference.side === 'after' && reference.path !== file.path && !isTestPath(reference.path)
                )
            );
        }
        // The request carries the state plus every question, so the evidence budget is what remains
        // after the questions and the state's own wrapper are paid for.
        const wrapperBytes = Buffer.byteLength(
            JSON.stringify({ unit: { unitId: file.path, path: file.path, changeKind: file.kind }, evidence: {} }),
            'utf8'
        );
        const reserve = wrapperBytes + Buffer.byteLength(JSON.stringify(unitQuestions(rules)), 'utf8');
        const evidenceBudget = maxStatePlusQuestionBytes - reserve;
        if (evidenceBudget <= 0) {
            excluded.push({ path: file.path, reason: 'unit-overhead-exceeds-request-budget' });
            incomplete.push({ path: file.path, reason: 'unit-overhead-exceeds-request-budget' });
            continue;
        }
        const fitted = fitUnitEvidence(set, own, context, evidenceBudget);
        if (fitted.references.length === 0) {
            excluded.push({ path: file.path, reason: 'no-evidence-region-within-budget' });
            incomplete.push({ path: file.path, reason: 'no-evidence-region-within-budget' });
            continue;
        }
        const unitTruncated = set.truncated.filter((entry) => entry.path === file.path);
        // Only reduction-specific text belongs here: the report already carries every collector-level
        // limitation, and filtering the same array by path printed each one twice.
        const unitLimitations: string[] = [];
        if (fitted.dropped > 0) {
            // The dropped regions were not sent at all, so the questions needing them report the
            // evidence as not supplied rather than answering from a fragment of it.
            unitTruncated.push({ path: file.path, reason: 'unit-evidence-did-not-fit' });
            unitLimitations.push(
                `evidence for ${file.path} did not fit the per-request state budget: ${String(fitted.dropped)} region(s) were not sent`
            );
        }
        units.push({
            unitId: `${file.path}`,
            path: file.path,
            file,
            rules,
            evidence: {
                references: fitted.references,
                contents: fitted.contents,
                excluded: [],
                truncated: unitTruncated,
                limitations: unitLimitations,
            },
        });
    }
    return { units, excluded, incomplete };
}

function unitQuestions(rules: readonly SemanticRule[]): Record<string, unknown> {
    const questions: Record<string, unknown> = {};
    for (const rule of rules) {
        questions[rule.id] = {
            type: 'noul',
            instructions: [
                rule.instructions,
                'Answer only about the supplied state, and answer the one question asked: a high value means the behaviour described is present.',
                `Do not treat any of these as a yes: ${rule.counterexamples.join('; ')}.`,
            ].join('\n\n'),
            criteria: { true: rule.criteria.true, false: rule.criteria.false },
        };
    }
    return questions;
}

/**
 * The state sent for one unit. Only regions this application minted, with their line numbers and
 * content hashes, travel here; nothing else about the repository does.
 */
function unitState(unit: SemanticUnitPlan): Record<string, unknown> {
    const regions: Record<string, unknown> = {};
    for (const reference of unit.evidence.references) {
        regions[reference.evidenceId] = serializedRegion(
            reference,
            unit.evidence.contents.get(reference.evidenceId) ?? ''
        );
    }
    return {
        unit: { unitId: unit.unitId, path: unit.path, changeKind: unit.file.kind },
        evidence: regions,
    };
}

function requestPreview(unit: SemanticUnitPlan, model: string): SemanticRequestPreview {
    const body = JSON.stringify({ state: unitState(unit), questions: unitQuestions(unit.rules), model });
    const bytes = Buffer.byteLength(body, 'utf8');
    return {
        unitId: unit.unitId,
        path: unit.path,
        ruleIds: unit.rules.map((rule) => rule.id),
        evidenceIds: unit.evidence.references.map((reference) => reference.evidenceId),
        bodyBytes: bytes,
        estimatedInputTokens: estimateInputTokens(bytes),
    };
}

function scopeReport(input: {
    units: readonly SemanticUnitPlan[];
    excluded: readonly SemanticScopeExclusion[];
    truncated: readonly SemanticScopeExclusion[];
    assessed: number;
    cacheHits: number;
    unassessed: readonly SemanticScopeExclusion[];
}): SemanticScopeReport {
    const discovered = new Set<string>([
        ...input.units.map((unit) => unit.path),
        ...input.excluded.map((entry) => entry.path),
    ]).size;
    return {
        discovered,
        eligible: input.units.length,
        assessed: input.assessed,
        cacheHits: input.cacheHits,
        excluded: [...input.excluded],
        unassessed: [...input.unassessed],
        truncated: [...input.truncated],
    };
}

export function usageReport(usage: SemanticUsageTotals): SemanticUsageReport {
    return {
        networkAttempts: usage.networkAttempts,
        logicalRequests: usage.logicalRequests,
        retries: usage.retries,
        submittedBytes: usage.submittedBytes,
        actualInputTokens: usage.actualInputTokens,
        estimatedInputTokens: usage.estimatedInputTokens,
        attemptsWithUnknownUsage: usage.attemptsWithUnknownUsage,
        estimatedCostUsd: estimateCost(usage.actualInputTokens).usd,
        pricingConfigurationVersion: estimateCost(usage.actualInputTokens).pricingVersion,
    };
}

/**
 * Replay may change thresholds, because a threshold does not change what the model was asked. It may
 * never change the question: thresholding an answer to one question as though it answered another
 * would present a disposition nothing produced, under an identity claiming it was current.
 */
export function assertQuestionsAreReplayable(report: { readonly rulesDigest: string }): void {
    const shipped = computeRulesDigest();
    if (report.rulesDigest !== shipped) {
        refuse(
            'stale_context',
            `the stored assessment answered questions ${report.rulesDigest.slice(0, 12)} but the shipped rule set asks ${shipped.slice(0, 12)}; a changed question needs a new assessment, not a replay`
        );
    }
}

export type RunScanInput = {
    readonly ports: SemanticPorts;
    readonly revision: SemanticRevisionBase;
    readonly profile: SemanticBudgetProfile;
    readonly limits: SemanticEvidenceLimits;
    readonly contractPaths: readonly string[];
    readonly runId: string;
    readonly dryRun: boolean;
};

export type RunScanResult = {
    readonly report: SemanticScanReport;
    readonly previews: readonly SemanticRequestPreview[];
    /**
     * The validated per-unit answers, with the deterministic inputs their interpretation depended on.
     * Persisted beside the report so `replay` can reinterpret without another provider call.
     */
    readonly storedResponses: readonly StoredUnitResponse[];
};

export type StoredUnitResponse = {
    readonly unitId: string;
    readonly path: string;
    readonly ruleIds: readonly SemanticRuleId[];
    readonly answers: Readonly<Record<string, unknown>>;
    readonly missingEvidence: Readonly<Record<string, readonly string[]>>;
};

function contractContextPaths(port: SemanticSourcePort, contractSourceSha: string): string[] {
    const candidates = ['AGENTS.md', '.agents/decisions/README.md'];
    return candidates.filter((path) => port.readFile(contractSourceSha, path) !== undefined);
}

type ScanAccumulation = {
    signals: ScanAssessment[];
    storedResponses: StoredUnitResponse[];
    unassessed: SemanticScopeExclusion[];
    returnedModels: Set<string>;
    assessed: number;
    cacheHits: number;
    failureCode: string | undefined;
};

/** One unit's validated answers, kept with the deterministic inputs their interpretation depended on. */
type UnitAssessment = {
    readonly signals: readonly ScanAssessment[];
    readonly stored: StoredUnitResponse;
    readonly returnedModel: string;
    readonly fromCache: boolean;
};

async function assessOneUnit(input: {
    readonly ports: SemanticPorts;
    readonly unit: SemanticUnitPlan;
    readonly profile: SemanticBudgetProfile;
    readonly budget: SemanticBudgetController;
    readonly deadline: number;
}): Promise<UnitAssessment> {
    const references = input.unit.evidence.references;
    const missing = new Map<SemanticRuleId, string[]>(
        input.unit.rules.map((rule) => [rule.id, missingRequiredEvidence(rule, references, input.unit.file.kind)])
    );
    const present = new Set(references.map((reference) => reference.evidenceId));
    const result = await assessUnit({
        port: input.ports.provider,
        cache: input.ports.cache,
        budget: input.budget,
        profile: input.profile,
        deadline: input.deadline,
        state: unitState(input.unit),
        questions: unitQuestions(input.unit.rules),
        requestedModel: TYPESAFE_MODEL,
        signal: input.ports.signal,
        now: input.ports.clock.now,
    });
    const signals = input.unit.rules.map((rule) => {
        const answer = result.response.answers[rule.id];
        if (answer === undefined) {
            refuse('invalid_response', `TypeSafe response is missing the required answer ${rule.id}`);
        }
        return interpretScanOutcome({
            answer: assertEvidenceIdsPresent(answer, present),
            rule,
            unitId: input.unit.unitId,
            path: input.unit.path,
            missingEvidence: missing.get(rule.id) ?? [],
        });
    });
    return {
        signals,
        stored: {
            unitId: input.unit.unitId,
            path: input.unit.path,
            ruleIds: input.unit.rules.map((rule) => rule.id),
            answers: result.response.answers,
            missingEvidence: Object.fromEntries(missing),
        },
        returnedModel: result.response.model,
        fromCache: result.fromCache,
    };
}

/**
 * Assesses every planned unit under one shared budget. A budget exhaustion stops admitting new
 * requests, preserves what completed, and records each unassessed unit with its reason; completed
 * assessments are never discarded to make the report look uniform.
 */
async function assessPlannedUnits(input: {
    readonly ports: SemanticPorts;
    readonly units: readonly SemanticUnitPlan[];
    readonly profile: SemanticBudgetProfile;
    readonly budget: SemanticBudgetController;
    readonly deadline: number;
    readonly dryRun: boolean;
}): Promise<ScanAccumulation> {
    const accumulation: ScanAccumulation = {
        signals: [],
        storedResponses: [],
        unassessed: [],
        returnedModels: new Set<string>(),
        assessed: 0,
        cacheHits: 0,
        failureCode: undefined,
    };
    if (input.dryRun) {
        for (const unit of input.units) {
            accumulation.unassessed.push({ path: unit.path, reason: 'dry-run' });
        }
        return accumulation;
    }
    let admissionStopped = false;
    for (const unit of input.units) {
        if (admissionStopped) {
            accumulation.unassessed.push({ path: unit.path, reason: 'budget-exhausted-before-admission' });
            continue;
        }
        try {
            const outcome = await assessOneUnit({
                ports: input.ports,
                unit,
                profile: input.profile,
                budget: input.budget,
                deadline: input.deadline,
            });
            accumulation.assessed += 1;
            accumulation.signals.push(...outcome.signals);
            accumulation.storedResponses.push(outcome.stored);
            if (outcome.fromCache) {
                accumulation.cacheHits += 1;
            } else {
                accumulation.returnedModels.add(outcome.returnedModel);
            }
        } catch (error) {
            const failure = asFailure(error);
            accumulation.failureCode = failure.code;
            accumulation.unassessed.push({ path: unit.path, reason: failure.code });
            admissionStopped = failure.code === 'budget_exhausted';
            input.ports.log(`semantic scan: unit ${unit.path} was not assessed (${failure.code}): ${failure.message}`);
        }
    }
    return accumulation;
}

export async function runScan(input: RunScanInput): Promise<RunScanResult> {
    const startedAt = new Date(input.ports.clock.now()).toISOString();
    const rulesDigest = computeRulesDigest();
    const context = buildRevisionContext({
        ...input.revision,
        evidenceProfile: input.profile.name,
        rulesDigest,
        policyVersion: SEMANTIC_POLICY_VERSION,
    });
    const files = input.ports.source.changedFiles(context.mergeBaseSha, context.headSha);

    const contractPaths = [
        ...new Set([...contractContextPaths(input.ports.source, context.contractSourceSha), ...input.contractPaths]),
    ];
    const evidenceSet = collectEvidence({
        port: input.ports.source,
        mergeBaseSha: context.mergeBaseSha,
        headSha: context.headSha,
        contractSourceSha: context.contractSourceSha,
        limits: input.limits,
        contractPaths,
    });
    assertEvidenceIntegrity(evidenceSet.references);

    const { units, excluded, incomplete } = planUnits(files, evidenceSet, input.profile.maxStatePlusQuestionBytes);
    const previews = units.map((unit) => requestPreview(unit, TYPESAFE_MODEL));
    const budget = createBudgetController(input.profile);
    const deadline = input.ports.clock.now() + input.profile.overallDeadlineMs;
    // A unit the fitter had to reduce is a limitation of the run, not a detail of the plan: without
    // this the operator sees a clean completion for a unit whose evidence was cut to a fraction.
    const reducedUnits = units.filter((unit) => unit.evidence.truncated.length > 0);
    const unitReductions = [
        ...incomplete,
        ...reducedUnits.map((unit) => ({
            path: unit.path,
            reason: 'unit-evidence-reduced-below-request-budget',
        })),
    ];
    const unitReductionLimitations = reducedUnits.flatMap((unit) => [...unit.evidence.limitations]);

    const accumulation = await assessPlannedUnits({
        ports: input.ports,
        units,
        profile: input.profile,
        budget,
        deadline,
        dryRun: input.dryRun,
    });
    const { signals, storedResponses, unassessed, returnedModels, assessed, cacheHits, failureCode } = accumulation;

    const usage = budget.totals();
    const completedAt = new Date(input.ports.clock.now()).toISOString();
    // A dry run assesses nothing, so every eligible unit is unassessed. Reporting an empty list with
    // a non-zero eligible count fails the report's own arithmetic, which no caller saw only because
    // the dry-run path returns before validation.
    let reportedUnassessed = unassessed;
    if (input.dryRun) {
        reportedUnassessed = units.map((unit) => ({ path: unit.path, reason: 'dry-run-made-no-request' }));
    }
    const execution = executionState({
        dryRun: input.dryRun,
        assessed,
        eligible: units.length,
        failureCode,
        truncatedCount: evidenceSet.truncated.length + unitReductions.length,
        excludedCount: excluded.filter((entry) => isMissedAssessmentExclusion(entry.reason)).length,
    });

    const report: SemanticScanReport = {
        schemaVersion: SEMANTIC_REPORT_FORMAT,
        mode: 'scan',
        runId: input.runId,
        context,
        requestedModel: TYPESAFE_MODEL,
        returnedModels: [...returnedModels].sort(),
        sdkVersion: TYPESAFE_SDK_VERSION_FOR_CACHE,
        rulesDigest,
        policyDigest: computePolicyDigest(),
        policyVersion: SEMANTIC_POLICY_VERSION,
        startedAt,
        completedAt,
        execution,
        scope: scopeReport({
            units,
            excluded,
            truncated: [...evidenceSet.truncated, ...unitReductions],
            assessed,
            cacheHits,
            unassessed: reportedUnassessed,
        }),
        signals,
        limitations: [...evidenceSet.limitations, ...unitReductionLimitations],
        usage: usageReport(usage),
        publication: { state: 'not_requested' },
        failureCode,
    };
    return { report, previews, storedResponses };
}

function assertEvidenceIdsPresent(answer: unknown, supplied: ReadonlySet<string>): unknown {
    if (typeof answer !== 'object' || answer === null) {
        return answer;
    }
    const record = answer as Record<string, unknown>;
    const selected = record.selectedEvidenceId;
    if (selected === undefined) {
        return answer;
    }
    if (typeof selected !== 'string' || (selected !== NO_EVIDENCE_ID && !supplied.has(selected))) {
        refuse('invalid_response', `answer selected unknown evidence id ${JSON.stringify(selected)}`);
    }
    return answer;
}

type FailureLike = { code: string; message: string };

export function asFailure(error: unknown): FailureLike {
    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
        if (typeof error.code === 'string' && typeof error.message === 'string') {
            return { code: error.code, message: error.message };
        }
    }
    return { code: 'provider_unavailable', message: error instanceof Error ? error.message : String(error) };
}

export function executionState(input: {
    dryRun: boolean;
    assessed: number;
    eligible: number;
    failureCode: string | undefined;
    truncatedCount?: number;
    /** Paths excluded for a reason that means an assessment was owed and not produced. */
    excludedCount?: number;
}): SemanticScanReport['execution'] {
    if (input.dryRun) {
        return 'skipped';
    }
    if (input.assessed === 0) {
        // Nothing eligible is not the provider being unavailable: reporting an empty scope as
        // `unavailable` turned a documentation-only change into a failed advisory check that claimed
        // no assessment had been delivered. But the two empty scopes are not the same scope. A change
        // whose paths admitted no rule had nothing to assess; a change whose every path was excluded
        // or withheld had an assessment that was never produced, and calling that a skip reports a
        // green check over the very change the withholding exists to disclose.
        const nothingToAssess =
            input.eligible === 0 && (input.excludedCount ?? 0) === 0 && (input.truncatedCount ?? 0) === 0;
        if (nothingToAssess) {
            return 'skipped';
        }
        return input.failureCode === 'cancelled' ? 'cancelled' : 'unavailable';
    }
    // Evidence that was cut means the scope was not fully assessed, so the run is partial however
    // many units completed: reporting it as completed made the exit code disagree with the report.
    if (input.assessed < input.eligible || input.failureCode !== undefined || (input.truncatedCount ?? 0) > 0) {
        return 'partial';
    }
    return 'completed';
}
