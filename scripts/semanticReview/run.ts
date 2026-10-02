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

import { changedLineFacts, type UnitChangedLineFacts } from './changeFacts.ts';
import {
    buildRevisionContext,
    refuse,
    SEMANTIC_POLICY_VERSION,
    SEMANTIC_REPORT_FORMAT,
    type EvidenceReference,
    type EvidenceSide,
    type SemanticRevisionBase,
    type SemanticScopeExclusion,
} from './contracts.ts';
import {
    assertEvidenceIntegrity,
    collectEvidence,
    compareByPath,
    exclusionReason,
    nothingSentReason,
    type SemanticEvidenceLimits,
    type SemanticEvidenceSet,
    type SemanticChangedFile,
    type SemanticSourcePort,
} from './evidence.ts';
import { unitReductionReason } from './fit.ts';
import { type ScanAssessment } from './interpret.ts';
import {
    assertAnswersMatchQuestions,
    composeUnitPasses,
    passRequestPayload,
    requestedPasses,
    type SemanticUnitPass,
} from './passes.ts';
import {
    assessUnit,
    createBudgetController,
    estimateInputTokens,
    TYPESAFE_MODEL,
    TYPESAFE_SDK_VERSION_FOR_CACHE,
    type SemanticBudgetController,
    type SemanticCachePort,
    type SemanticProviderPort,
} from './provider.ts';
import { type SemanticScanReport } from './report.ts';
import { scopeReport, usageReport } from './reporting.ts';
import { unitReservationBytes, unitStatePlusQuestionBytes } from './requestPayload.ts';
import {
    applicableRules,
    computePolicyDigest,
    computeRulesDigest,
    isCollectedSpec,
    unitNeedsContractContext,
    type SemanticBudgetProfile,
    type SemanticRule,
    type SemanticRuleId,
} from './rules.ts';
import {
    buildScopeStates,
    BUDGET_STOPPED_REASON,
    DEADLINE_STOPPED_REASON,
    DRY_RUN_REASON,
    isMissedAssessmentExclusion,
    MISSING_REQUIRED_EVIDENCE_REASON,
} from './scopeAccounting.ts';
import {
    mergeUnitAnswers,
    type AssessedPass,
    type MergedUnitAssessment,
    type StoredUnitResponse,
} from './unitAssessment.ts';
import { orderPlannedUnits, plannedRequest, unitOmission } from './unitPriority.ts';

export type { StoredUnitResponse } from './unitAssessment.ts';
/** Re-exported here because the run's own completion decision reads it and callers import it from the plan. */
export { isMissedAssessmentExclusion } from './scopeAccounting.ts';

export type SemanticClock = { readonly now: () => number };

/**
 * The exact request payload bytes the provider measures for one unit, re-exported here because this
 * module owns the plan whose reservation has to agree with that measurement.
 */
export { unitStatePlusQuestionBytes };
export { usageReport } from './reporting.ts';

export type SemanticPorts = {
    readonly source: SemanticSourcePort;
    readonly provider: SemanticProviderPort;
    readonly cache: SemanticCachePort;
    readonly clock: SemanticClock;
    readonly signal: AbortSignal;
    readonly log: (message: string) => void;
};

export type SemanticUnitPlan = {
    readonly unitId: string;
    readonly path: string;
    readonly file: SemanticChangedFile;
    readonly rules: readonly SemanticRule[];
    readonly evidence: SemanticUnitEvidence;
    /**
     * The deterministic facts about this unit's own added and removed lines. They travel in the unit's
     * request so the two test-validity rules the audit found false-alarming read the edit itself rather
     * than inferring it from surrounding source, and they are computed once here so the reservation and
     * the payload cannot disagree about their size.
     */
    readonly changedLineFacts: UnitChangedLineFacts;
};

/**
 * The evidence one unit carries, with its own regions kept distinct from the context regions a rule
 * declared it needed. The requirement predicate resolves a side against the set it belongs to: the
 * unit's `before`/`after` come from its own regions, `context` from the context regions, and a dropped
 * side unsupplies only the set it was dropped from.
 */
export type SemanticUnitEvidence = {
    readonly own: readonly EvidenceReference[];
    readonly context: readonly EvidenceReference[];
    /** The union of own and context, in send order: the payload the provider receives. */
    readonly references: readonly EvidenceReference[];
    readonly contents: ReadonlyMap<string, string>;
    /**
     * The ordered passes this unit's evidence travels in. Exactly one when everything fits one
     * request; several when the unit exceeded the per-request budget and the region set was
     * partitioned. A unit whose every region individually exceeds the budget has no passes and is
     * excluded before assessment.
     */
    readonly passes: readonly SemanticUnitPass[];
    readonly ownDroppedSides: ReadonlySet<EvidenceSide>;
    readonly contextDroppedSides: ReadonlySet<EvidenceSide>;
    /**
     * The sides the per-request fitter dropped for this unit, kept apart from the collector
     * withholdings merged into `ownDroppedSides`/`contextDroppedSides`, so the reduced-unit record can
     * name exactly what the fitter cut.
     */
    readonly fittedDroppedSides: ReadonlySet<EvidenceSide>;
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly truncated: readonly SemanticScopeExclusion[];
    readonly limitations: readonly string[];
};

/** Whether a region was minted for the given changed file, by post-change path. */
function isAttributedTo(set: SemanticEvidenceSet, reference: EvidenceReference, changedPath: string): boolean {
    return set.attribution.get(reference.evidenceId)?.includes(changedPath) ?? false;
}

function evidenceForPath(set: SemanticEvidenceSet, changedPath: string): EvidenceReference[] {
    // A region belongs to the changed file that minted it, not to whichever path its text came from.
    // Selecting by (path, side) alone handed a copy unit the source's before region — or the modified
    // source the copy's — when two changed files share a before-side path, because the two regions
    // carry the same path and differ only in range.
    return set.references.filter((reference) => isAttributedTo(set, reference, changedPath));
}

/**
 * The sides a unit dropped, combining the fitter's drops with the collector's withholdings. A side the
 * collector withheld at admission — one hunk over a budget or a credential-shaped region — is the same
 * loss as one the fitter dropped later, so it must unsupply the side exactly as a fitter drop does.
 */
function mergedDroppedSides(
    fitted: ReadonlySet<EvidenceSide>,
    withheld: ReadonlySet<EvidenceSide> | undefined
): ReadonlySet<EvidenceSide> {
    if (withheld === undefined || withheld.size === 0) {
        return fitted;
    }
    return new Set<EvidenceSide>([...fitted, ...withheld]);
}

/**
 * The sides the collector withheld from the files that supply this unit's context. Contract
 * withholdings live in `withheldSides.context`, but the implementation context is assembled from the
 * other changed files' after regions, and a withholding of one of those files is keyed to that file in
 * `withheldSides.own`. Reading the owning files from the surviving references misses a file whose
 * after side was withheld *entirely*: nothing survives to attribute, so its recorded withholding was
 * never consulted and a second, clean implementation file satisfied the implementation token. The
 * candidates are therefore read from the withholding map directly — the changed files that are not
 * collected specs and not the unit's own path — which also subsumes the partial case a previous repair
 * handled: a file with one surviving hunk and one withheld hunk still unsupplies the side exactly as
 * that repair established.
 *
 * The blast radius is deliberate: one withheld implementation file unsupplies the implementation token
 * for every unit whose rules need it. That is the same conservative propagation the contract context
 * already uses, and for a rule that exists to catch a bypassed test an unresolved answer beats a
 * decisive one built on the wrong file.
 */
function withheldContextSides(
    set: SemanticEvidenceSet,
    files: readonly SemanticChangedFile[],
    ownPath: string,
    needsImplementation: boolean
): ReadonlySet<EvidenceSide> {
    const sides = new Set<EvidenceSide>(set.withheldSides.context);
    if (needsImplementation) {
        for (const candidate of files) {
            if (candidate.path === ownPath || isCollectedSpec(candidate.path)) {
                continue;
            }
            for (const side of set.withheldSides.own.get(candidate.path) ?? []) {
                sides.add(side);
            }
        }
    }
    return sides;
}

/**
 * Whether a rule of this unit declares it needs the changed implementation's source. A rule that does is
 * asking about a path that is usually not the one under assessment, so the planner supplies the changed
 * implementation's after side as context: without this the declaration was unsatisfiable and the rule
 * silently scored anyway, and with it a change whose implementation is unchanged reports the evidence as
 * missing.
 */
function unitNeedsImplementationSource(rules: readonly SemanticRule[]): boolean {
    return rules.some((rule) => rule.requiredEvidence.some((token) => /implementation/iu.test(token)));
}

/**
 * The deterministic facts about one unit's own changed lines. The map is keyed by each change's own
 * post-change path, so a unit never carries another file's lines, and a path the source could not read
 * leaves the facts unavailable rather than reporting an empty edit.
 */
function unitChangeFacts(set: SemanticEvidenceSet, file: SemanticChangedFile): UnitChangedLineFacts {
    return changedLineFacts(set.changedLines.get(file.path));
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
        // A rename that moved a test out of collection must admit the test-validity questions: the
        // destination path is no longer a test, but the previous path is, and `applicableRules` admits
        // a rule when any offered path matches.
        const rules = applicableRules(file.previousPath === undefined ? [file.path] : [file.path, file.previousPath]);
        if (rules.length === 0) {
            excluded.push({ path: file.path, reason: 'no-applicable-rule' });
            continue;
        }
        const own = evidenceForPath(set, file.path);
        if (own.length === 0) {
            // Context regions alone would otherwise make a wholly-withheld file count as assessed.
            // One exclusion per path: collection may already have excluded it, and a second entry
            // would break the manifest's own arithmetic. The reason comes from why the collector
            // withheld the file's sides — the size gate or inadmissibility — and a side's region is
            // keyed to the path it was read from, which for a before side is the previous path.
            if (!excludedPaths.has(file.path)) {
                excluded.push({
                    path: file.path,
                    reason: nothingSentReason(
                        set.truncated.filter((entry) => entry.path === file.path || entry.path === file.previousPath)
                    ),
                });
            }
            continue;
        }
        const needsContract = unitNeedsContractContext(rules);
        const unitChangedLineFacts = unitChangeFacts(set, file);
        const needsImplementation = unitNeedsImplementationSource(rules);
        let context: EvidenceReference[] = [];
        if (needsContract) {
            context = set.references.filter((reference) => reference.side === 'context');
        }
        if (needsImplementation) {
            context = context.concat(
                set.references.filter(
                    (reference) =>
                        reference.side === 'after' &&
                        !isCollectedSpec(reference.path) &&
                        !isAttributedTo(set, reference, file.path)
                )
            );
        }
        // The request carries the state plus every question, so the evidence budget is what remains
        // after the questions and the state's own envelope are paid for — measured by the same builder
        // the provider refuses over, with the evidence map still empty because no region is chosen yet.
        const evidenceBudget = maxStatePlusQuestionBytes - unitReservationBytes(file, rules, unitChangedLineFacts);
        if (evidenceBudget <= 0) {
            excluded.push({ path: file.path, reason: 'unit-overhead-exceeds-request-budget' });
            incomplete.push({ path: file.path, reason: 'unit-overhead-exceeds-request-budget' });
            continue;
        }
        const unitId = `${file.path}`;
        const composed = composeUnitPasses(set, own, context, unitId, evidenceBudget);
        if (composed.references.length === 0) {
            excluded.push({ path: file.path, reason: 'no-evidence-region-within-budget' });
            incomplete.push({ path: file.path, reason: 'no-evidence-region-within-budget' });
            continue;
        }
        const unitTruncated = set.truncated.filter((entry) => entry.path === file.path);
        // Only reduction-specific text belongs here: the report already carries every collector-level
        // limitation, and filtering the same array by path printed each one twice.
        const unitLimitations: string[] = [];
        if (composed.dropped > 0) {
            // A region dropped because no pass could carry it was not sent at all, so the questions
            // needing it report the evidence as not supplied rather than answering from a fragment.
            unitTruncated.push({ path: file.path, reason: 'unit-evidence-did-not-fit' });
            unitLimitations.push(
                `evidence for ${file.path} did not fit the per-request state budget: ${String(composed.dropped)} region(s) were not sent`
            );
        }
        units.push({
            unitId,
            path: file.path,
            file,
            rules,
            changedLineFacts: unitChangedLineFacts,
            evidence: {
                own: composed.passes.flatMap((pass) => pass.own),
                context: composed.passes.flatMap((pass) => pass.context),
                references: composed.references,
                contents: composed.contents,
                passes: composed.passes,
                excluded: [],
                truncated: unitTruncated,
                limitations: unitLimitations,
                ownDroppedSides: mergedDroppedSides(composed.ownDroppedSides, set.withheldSides.own.get(file.path)),
                contextDroppedSides: mergedDroppedSides(
                    composed.contextDroppedSides,
                    withheldContextSides(set, files, file.path, needsImplementation)
                ),
                fittedDroppedSides: composed.fittedDroppedSides,
            },
        });
    }
    // Admission order is the plan's own decision, not the path order the files arrived in: a binding
    // budget or deadline reads the risk and the answerable evidence each unit carries, and the path is
    // only the final tie-break between units that key identically.
    return { units: orderPlannedUnits(units), excluded, incomplete };
}

/**
 * One unit's requests as a dry run reports them: the questions its passes can ask, the evidence those
 * requests would carry, and the evidence the plan composed for it whether or not a question needs it.
 * The two evidence sets are kept apart on purpose — a unit whose every pass carries regions no question
 * can be answered from sends nothing, and the plan's composition is exactly what an operator has to see
 * to understand why.
 */
export type SemanticRequestPreview = {
    readonly unitId: string;
    readonly path: string;
    /** Every rule that applies to the unit; `askedRuleIds` is the subset its requests would ask. */
    readonly ruleIds: readonly SemanticRuleId[];
    /** The rules the requests would ask: the ones a sent pass carries the required evidence for. */
    readonly askedRuleIds: readonly SemanticRuleId[];
    /** Every region the plan composed for the unit, across every pass, sent or not. */
    readonly evidenceIds: readonly string[];
    /** The regions the requests would carry. */
    readonly sentEvidenceIds: readonly string[];
    /** The bytes those requests would submit; 0 when no pass can ask anything. */
    readonly bodyBytes: number;
    readonly estimatedInputTokens: number;
    /** Why no request would be sent, when no pass carries the evidence any question requires. */
    readonly omissionReason?: string;
};

/**
 * What one unit's requests would carry and measure. Body bytes are read from the passes the requests
 * would actually send, so a dry run's export agrees with what a live run does instead of pricing
 * questions that would never be asked. It lives here with the run's own request accounting: the byte and
 * token measures are the provider's, and a preview built beside the pass composition would drag the
 * adapter into every closure that reads a report.
 */
function requestPreview(unit: SemanticUnitPlan, model: string): SemanticRequestPreview {
    const sent = requestedPasses({
        rules: unit.rules,
        kind: unit.file.kind,
        evidence: unit.evidence,
    });
    let bodyBytes = 0;
    for (const entry of sent) {
        const payload = passRequestPayload({
            unitId: unit.unitId,
            path: unit.path,
            file: unit.file,
            rules: entry.rules,
            pass: entry.pass,
            changedLineFacts: unit.changedLineFacts,
        });
        bodyBytes += Buffer.byteLength(JSON.stringify({ ...payload, model }), 'utf8');
    }
    const preview: SemanticRequestPreview = {
        unitId: unit.unitId,
        path: unit.path,
        ruleIds: unit.rules.map((rule) => rule.id),
        askedRuleIds: sent.flatMap((entry) => entry.rules.map((rule) => rule.id)),
        evidenceIds: unit.evidence.passes.flatMap((pass) => pass.references.map((reference) => reference.evidenceId)),
        sentEvidenceIds: sent.flatMap((entry) => entry.pass.references.map((reference) => reference.evidenceId)),
        bodyBytes,
        estimatedInputTokens: estimateInputTokens(bodyBytes),
    };
    return sent.length === 0 ? { ...preview, omissionReason: MISSING_REQUIRED_EVIDENCE_REASON } : preview;
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

type ScanAccumulation = {
    signals: ScanAssessment[];
    storedResponses: StoredUnitResponse[];
    unassessed: SemanticScopeExclusion[];
    returnedModels: Set<string>;
    assessed: number;
    cacheHits: number;
    failureCode: string | undefined;
};

/** One unit's merged answers, with the number of requests it actually sent. */
type UnitAssessment = MergedUnitAssessment & {
    /**
     * The requests this unit sent. Zero means no pass could ask any of its questions: the unit is
     * recorded as an omission, and its rules still report the evidence every request would have lacked.
     */
    readonly providerCalls: number;
};

/**
 * Asks one unit everything it can answer. Each pass sends only the questions it carries the required
 * evidence for, and a pass with no question left is not sent at all; the merge then reads each rule's
 * answer from the pass that best carries it.
 */
async function assessOneUnit(input: {
    readonly ports: SemanticPorts;
    readonly unit: SemanticUnitPlan;
    readonly profile: SemanticBudgetProfile;
    readonly budget: SemanticBudgetController;
    readonly deadline: number;
}): Promise<UnitAssessment> {
    const unit = input.unit;
    const assessedPasses: AssessedPass[] = [];

    for (const { pass, rules } of requestedPasses({
        rules: unit.rules,
        kind: unit.file.kind,
        evidence: unit.evidence,
    })) {
        const payload = passRequestPayload({
            unitId: unit.unitId,
            path: unit.path,
            file: unit.file,
            rules,
            pass,
            changedLineFacts: unit.changedLineFacts,
        });
        const result = await assessUnit({
            port: input.ports.provider,
            cache: input.ports.cache,
            budget: input.budget,
            profile: input.profile,
            deadline: input.deadline,
            ...payload,
            requestedModel: TYPESAFE_MODEL,
            signal: input.ports.signal,
            now: input.ports.clock.now,
        });
        const askedRuleIds = rules.map((rule) => rule.id);
        assertAnswersMatchQuestions({ unitId: unit.unitId, answers: result.response.answers, askedRuleIds });
        assessedPasses.push({ pass, askedRuleIds, result });
    }

    return { ...mergeUnitAnswers({ unit, assessedPasses }), providerCalls: assessedPasses.length };
}

/**
 * The reason recorded for every unit a stopped run never admitted, keyed by the failure that stopped
 * admission. A per-request refusal is absent on purpose: it is a property of that unit's request, so
 * the units after it keep their bytes and attempts and must stay assessable.
 */
const STOPPED_ADMISSION_REASONS: Readonly<Record<string, string>> = {
    budget_exhausted: BUDGET_STOPPED_REASON,
    deadline_elapsed: DEADLINE_STOPPED_REASON,
};

/**
 * Assesses every planned unit under one shared budget. A budget exhaustion or an elapsed deadline stops
 * admitting new requests, preserves what completed, and records each unassessed unit with its reason;
 * completed assessments are never discarded to make the report look uniform.
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
            accumulation.unassessed.push(unitOmission(unit, DRY_RUN_REASON));
        }
        return accumulation;
    }
    let stoppedReason: string | undefined;
    for (const unit of input.units) {
        if (stoppedReason !== undefined) {
            accumulation.unassessed.push(unitOmission(unit, stoppedReason));
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
            accumulation.signals.push(...outcome.signals);
            accumulation.storedResponses.push(outcome.stored);
            // A unit no pass could ask sent nothing. It is not an assessment — no answer exists — so it
            // is recorded as an omission under its own reason, while its stored record keeps every rule
            // reporting the evidence no request could have carried.
            if (outcome.providerCalls === 0) {
                accumulation.unassessed.push(unitOmission(unit, MISSING_REQUIRED_EVIDENCE_REASON));
                input.ports.log(
                    `semantic scan: unit ${unit.path} was not asked (no pass carries its required evidence)`
                );
                continue;
            }
            accumulation.assessed += 1;
            if (outcome.fromCache) {
                accumulation.cacheHits += 1;
            } else {
                for (const model of outcome.returnedModels) {
                    accumulation.returnedModels.add(model);
                }
            }
        } catch (error) {
            const failure = asFailure(error);
            accumulation.failureCode = failure.code;
            accumulation.unassessed.push(unitOmission(unit, failure.code));
            stoppedReason = STOPPED_ADMISSION_REASONS[failure.code];
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

    const evidenceSet = collectEvidence({
        port: input.ports.source,
        mergeBaseSha: context.mergeBaseSha,
        headSha: context.headSha,
        contractSourceSha: context.contractSourceSha,
        limits: input.limits,
        contractPaths: input.contractPaths,
        includeDefaultContractContext: true,
    });
    assertEvidenceIntegrity(evidenceSet.references);

    const { units, excluded, incomplete } = planUnits(files, evidenceSet, input.profile.maxStatePlusQuestionBytes);
    const previews = units.map((unit) => requestPreview(unit, TYPESAFE_MODEL));
    const budget = createBudgetController(input.profile);
    const deadline = input.ports.clock.now() + input.profile.overallDeadlineMs;
    // A unit the fitter had to reduce is a limitation of the run, not a detail of the plan: without
    // this the operator sees a clean completion for a unit whose evidence was cut to a fraction. Only a
    // fitted drop is a reduction: a unit whose truncation entries are the collector's own withholdings
    // was never reduced below the request budget, and recording it as one named a cause that never
    // occurred. Those entries stay in the scope's `truncated` list exactly as the collector wrote them.
    const reducedUnits = units.filter((unit) => unit.evidence.fittedDroppedSides.size > 0);
    const unitReductions = [
        ...incomplete,
        ...reducedUnits.map((unit) => ({
            path: unit.path,
            reason: unitReductionReason(unit.evidence.fittedDroppedSides),
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
            unitPaths: units.map((unit) => unit.path),
            excluded,
            truncated: [...evidenceSet.truncated, ...unitReductions],
            assessed,
            cacheHits,
            unassessed,
            requestOrder: units.map((unit) => plannedRequest(unit)),
            states: buildScopeStates({ excluded, unassessed }),
        }),
        signals,
        limitations: [...evidenceSet.limitations, ...unitReductionLimitations],
        usage: usageReport(usage),
        publication: { state: 'not_requested' },
        failureCode,
    };
    return { report, previews, storedResponses };
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
