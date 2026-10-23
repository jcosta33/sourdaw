/**
 * Candidate-finding verification.
 *
 * Assesses whether a proposed finding is supported by the supplied implementation before the
 * orchestrator decides what to publish. This is an additional check, not an automatic rejection
 * filter, and it never publishes anything: only the existing orchestrator and its validated
 * publication path may accept, discard, record, or act on a finding.
 *
 * Reported observations and verified execution evidence are kept distinct, so a claim that a test was
 * executed can never be manufactured by the model from a reported note.
 */

import {
    assertFindingIdsAreDistinct,
    assertFindingsBoundToHead,
    parseCandidateFindings,
    type CandidateFinding,
    type CandidateFindingEvidence,
} from './candidateFindings.ts';
import {
    buildRevisionContext,
    NO_EVIDENCE_ID,
    refuse,
    semanticDigest,
    SEMANTIC_POLICY_VERSION,
    SEMANTIC_REPORT_FORMAT,
    type EvidenceReference,
    type SemanticRevisionBase,
    type SemanticScopeExclusion,
} from './contracts.ts';
import {
    assertEvidenceIntegrity,
    compareLexicographic,
    CREDENTIAL_SHAPED_WITHHELD_CODE,
    evidenceSidePrefix,
    isContractCarryingContent,
    isSensitivePath,
    nothingSentReason,
    SENSITIVE_PATH_WITHHELD_CODE,
    withheldRegionCarriesContract,
    withheldRegionReason,
    type SemanticEvidenceLimits,
    type SemanticEvidenceSet,
    type SemanticSourcePort,
} from './evidence.ts';
import { regionCost } from './fit.ts';
import { interpretFinding, type FindingAssessment } from './interpret.ts';
import {
    assessUnit,
    createBudgetController,
    TYPESAFE_MODEL,
    TYPESAFE_SDK_VERSION_FOR_CACHE,
    type SemanticBudgetController,
} from './provider.ts';
import { verifyRequestPreview, type SemanticVerifyRequestPreview } from './requestPayload.ts';
import { computePolicyDigest, type SemanticBudgetProfile } from './rules.ts';
import { asFailure, executionState, usageReport, type SemanticPorts } from './run.ts';
import { DRY_RUN_REASON } from './scopeAccounting.ts';
import { sensitiveContentReason } from './sensitive.ts';
import { sliceLines } from './slicing.ts';
import { computeVerifyQuestionsDigest, findingQuestions } from './verifyQuestions.ts';

import type { SemanticVerifyReport } from './report.ts';

export { assertFindingIdsAreDistinct, assertFindingsBoundToHead, parseCandidateFindings };
export type { CandidateFinding, CandidateFindingEvidence };
export { computeVerifyQuestionsDigest };

function findingState(
    finding: CandidateFinding,
    evidence: { readonly references: readonly EvidenceReference[]; readonly contents: ReadonlyMap<string, string> }
): Record<string, unknown> {
    const regions: Record<string, unknown> = {};
    for (const reference of evidence.references) {
        regions[reference.evidenceId] = {
            path: reference.path,
            side: reference.side,
            revisionSha: reference.revisionSha,
            startLine: reference.startLine,
            endLine: reference.endLine,
            content: evidence.contents.get(reference.evidenceId) ?? '',
        };
    }
    const described: Record<string, unknown> = {
        findingId: finding.findingId,
        claim: finding.claim,
        expectedBehavior: finding.expectedBehavior,
        reproductionReferences: (finding.reproductionReferences ?? []).map((reference) => ({
            path: reference.path,
            note: reference.note,
            evidenceKind: reference.verifiedExecution ? 'verified-execution' : 'reported-observation',
        })),
    };
    if (finding.allegedFailureInputOrState !== undefined) {
        described.allegedFailureInputOrState = finding.allegedFailureInputOrState;
    }
    if (finding.allegedObservedBehavior !== undefined) {
        described.allegedObservedBehavior = finding.allegedObservedBehavior;
    }
    return { finding: described, evidence: regions };
}

/** The payload one finding's request sends: the state the provider reads and the questions it answers. */
function findingRequestPayload(
    finding: CandidateFinding,
    evidence: { readonly references: readonly EvidenceReference[]; readonly contents: ReadonlyMap<string, string> }
): { readonly state: Record<string, unknown>; readonly questions: Record<string, unknown> } {
    return {
        state: findingState(finding, evidence),
        questions: findingQuestions(
            finding,
            evidence.references.map((reference) => reference.evidenceId)
        ),
    };
}

/** The exact bytes the provider measures for one finding's request: its state plus its questions. */
function findingRequestBytes(
    finding: CandidateFinding,
    evidence: { readonly references: readonly EvidenceReference[]; readonly contents: ReadonlyMap<string, string> }
): number {
    return Buffer.byteLength(JSON.stringify(findingRequestPayload(finding, evidence)), 'utf8');
}

/** The request a dry run reports for a finding whose every named region was withheld: the empty one. */
function withheldRequestPreview(finding: CandidateFinding, cause: string): SemanticVerifyRequestPreview {
    return verifyRequestPreview(
        finding.findingId,
        findingRequestPayload(finding, { references: [], contents: new Map() }),
        TYPESAFE_MODEL,
        cause
    );
}

/**
 * The outcome for a finding whose every named region was withheld: nothing assessed, under the cause
 * that withheld it. A dry run records the omission its report arithmetic reads instead, and previews
 * the empty request the live path never sends.
 */
function withheldOutcome(input: {
    readonly finding: CandidateFinding;
    readonly dryRun: boolean;
    readonly cause: string;
    readonly limitations: readonly string[];
    readonly truncated: readonly SemanticScopeExclusion[];
}) {
    let unassessedReason = input.cause;
    let preview: SemanticVerifyRequestPreview | undefined;
    if (input.dryRun) {
        unassessedReason = DRY_RUN_REASON;
        preview = withheldRequestPreview(input.finding, input.cause);
    }
    return {
        assessment: undefined,
        returnedModel: undefined,
        limitations: input.limitations,
        truncated: input.truncated,
        fromCache: false,
        unassessedReason,
        preview,
    };
}

/**
 * Fits one finding's collected regions inside the per-request state ceiling, keeping every region whose
 * addition fits and skipping only the ones that do not, recording every skip.
 *
 * The per-region gate bounds one region, not the request: a region the region ceiling admits, plus the
 * questions, can still exceed the state ceiling — and the id list the strongest-evidence question
 * carries grows with the regions supplied, so the gap widens with a longer claim or expected behavior.
 * The provider then refuses the whole finding, which loses it and discloses nothing. The questions
 * depend on which regions are supplied, so each candidate is measured against the real payload rather
 * than a per-region share of it.
 *
 * The policy is the scan fitter's: a region that cannot fit is skipped, never a reason to stop. Popping
 * from the tail instead dropped a fitting region whenever an unfittable one sorted before it, so a
 * finding whose first region was too large lost the rest of its evidence too.
 */
function fitFindingEvidence(input: {
    readonly finding: CandidateFinding;
    readonly set: SemanticEvidenceSet;
    readonly maxStatePlusQuestionBytes: number;
}): {
    references: EvidenceReference[];
    contents: Map<string, string>;
    truncated: SemanticScopeExclusion[];
    limitations: string[];
} {
    const references: EvidenceReference[] = [];
    const contents = new Map<string, string>();
    const truncated: SemanticScopeExclusion[] = [];
    const limitations: string[] = [];
    for (const reference of input.set.references) {
        const text = input.set.contents.get(reference.evidenceId) ?? '';
        references.push(reference);
        contents.set(reference.evidenceId, text);
        if (findingRequestBytes(input.finding, { references, contents }) <= input.maxStatePlusQuestionBytes) {
            continue;
        }
        // This candidate is what the request cannot carry; the ones already kept stay kept, so a later
        // smaller region still gets its turn.
        references.pop();
        contents.delete(reference.evidenceId);
        truncated.push({
            path: reference.path,
            reason: withheldRegionReason(
                withheldRegionCarriesContract(reference.side, isContractCarryingContent(reference.path, text)),
                reference.side,
                'request'
            ),
        });
        limitations.push(
            `finding evidence ${reference.path} (${reference.side}) was not supplied: the request carrying it exceeds the per-request state budget`
        );
    }
    return { references, contents, truncated, limitations };
}

/** The revision a finding's evidence side is read from. */
function revisionForSide(
    side: EvidenceReference['side'],
    input: { readonly mergeBaseSha: string; readonly headSha: string; readonly contractSourceSha: string }
): string {
    if (side === 'before') {
        return input.mergeBaseSha;
    }
    if (side === 'context') {
        return input.contractSourceSha;
    }
    return input.headSha;
}

function collectFindingEvidence(input: {
    port: SemanticSourcePort;
    finding: CandidateFinding;
    mergeBaseSha: string;
    headSha: string;
    contractSourceSha: string;
    limits: SemanticEvidenceLimits;
}): SemanticEvidenceSet {
    const references: EvidenceReference[] = [];
    const contents = new Map<string, string>();
    const truncated: SemanticScopeExclusion[] = [];
    const limitations: string[] = [];
    let ordinal = 1;
    const wanted = [...input.finding.evidenceReferences].sort((left, right) =>
        compareLexicographic(`${left.side}:${left.path}`, `${right.side}:${right.path}`)
    );
    for (const reference of wanted) {
        // The same gate the scan path applies. Without it a finding could name any tracked file — a
        // committed key, or a credential in an ordinary-named file — and have it sent verbatim.
        if (isSensitivePath(reference.path)) {
            // Recorded as incomplete scope: a finding's evidence is not a unit of its own, so counting
            // it as an exclusion would break the manifest's arithmetic as well as the completion state.
            truncated.push({ path: reference.path, reason: SENSITIVE_PATH_WITHHELD_CODE });
            limitations.push(`finding evidence ${reference.path} was withheld: it is on the sensitive-path list`);
            continue;
        }
        const revision = revisionForSide(reference.side, input);
        const text = input.port.readFile(revision, reference.path);
        if (text === undefined) {
            // Recorded as missing evidence, not only a note: the attribution question compares before
            // against after, so a dropped side cannot be silently absent from the answer.
            truncated.push({ path: reference.path, reason: 'evidence-unavailable-at-revision' });
            limitations.push(
                `finding evidence ${reference.path} (${reference.side}) was unavailable at ${revision.slice(0, 12)}`
            );
            continue;
        }
        const unsafe = sensitiveContentReason(text);
        if (unsafe !== undefined) {
            // Before any bounds decision, matching the scan route's order: content that must not leave
            // the machine names the credential cause on both routes even when the named range is also
            // past the file, because that is why nothing left.
            truncated.push({ path: reference.path, reason: CREDENTIAL_SHAPED_WITHHELD_CODE });
            limitations.push(`finding evidence ${reference.path} was withheld: it contains ${unsafe}`);
            continue;
        }
        // The finding named a range, so the range is what leaves the machine. Reading and hashing the
        // whole file sent a scope wider than the one the caller asked about, and reported bounds the
        // request never used. The screen above still judges the whole file, because withholding has to
        // be decided on everything the file holds rather than on the part being quoted. The same slice
        // the scan path applies clamps the range, and a range that starts past the file names no line
        // this revision holds: both routes then refuse and record the same hunk-beyond-file reference,
        // a side the screen kept.
        const sliced = sliceLines(text, { startLine: reference.startLine, endLine: reference.endLine });
        if (sliced === undefined) {
            truncated.push({
                path: reference.path,
                reason: withheldRegionReason(
                    withheldRegionCarriesContract(reference.side, isContractCarryingContent(reference.path, text)),
                    reference.side,
                    'hunk-beyond-file'
                ),
            });
            limitations.push(
                `finding evidence ${reference.path} (${reference.side}) names lines this revision does not hold`
            );
            continue;
        }
        const region = sliced.text;
        const evidenceId = `${evidenceSidePrefix(reference.side)}${String(ordinal)}`;
        const evidenceReference: EvidenceReference = {
            evidenceId,
            revisionSha: revision,
            path: reference.path,
            side: reference.side,
            startLine: sliced.range.startLine,
            endLine: sliced.range.endLine,
            contentHash: semanticDigest({ region }),
        };
        // A region is supplied whole or not at all, exactly as the scan path's admission does. Sending
        // it and then naming it truncated made `interpretFinding` read evidence it had been given as
        // missing, while the region still left the machine past the per-region budget. An oversized
        // region is withheld and named with the shared withheld-region reason. The gate costs the
        // serialized bytes the fitter uses, not the raw bytes: JSON escapes every newline, so a
        // raw-byte estimate admitted a region the provider then refused, recording a run-wide
        // `budget_exhausted` failure instead of the per-region limitation.
        if (regionCost(evidenceReference, region) > input.limits.maxRegionBytes) {
            truncated.push({
                path: reference.path,
                reason: withheldRegionReason(
                    withheldRegionCarriesContract(reference.side, isContractCarryingContent(reference.path, text)),
                    reference.side,
                    'region'
                ),
            });
            limitations.push(
                `finding evidence ${reference.path} (${reference.side}) was not supplied: it exceeds the per-region budget`
            );
            continue;
        }
        ordinal += 1;
        references.push(evidenceReference);
        contents.set(evidenceId, region);
    }
    return {
        references,
        contents,
        attribution: new Map(),
        // A finding's request carries no unit change facts, and the only reader of `changedLines` is the
        // scan planner, which no verification run reaches. The set is assembled without them rather than
        // paying for a diff read nothing here consumes.
        changedLines: new Map(),
        excluded: [],
        truncated,
        limitations,
        withheldSides: { own: new Map(), context: new Set() },
    };
}

export type RunVerifyInput = {
    readonly ports: SemanticPorts;
    readonly revision: SemanticRevisionBase;
    readonly profile: SemanticBudgetProfile;
    readonly findings: readonly CandidateFinding[];
    readonly runId: string;
    /** A dry run builds every finding's request and reports it instead of calling the provider. */
    readonly dryRun: boolean;
};

export type RunVerifyResult = {
    readonly report: SemanticVerifyReport;
    /** The request each finding would send, in finding order; the `--export-payload` material. */
    readonly previews: readonly SemanticVerifyRequestPreview[];
};

type VerifyAccumulation = {
    assessments: FindingAssessment[];
    unassessed: SemanticScopeExclusion[];
    returnedModels: Set<string>;
    assessed: number;
    cacheHits: number;
    failureCode: string | undefined;
    limitations: string[];
    truncated: SemanticScopeExclusion[];
    previews: SemanticVerifyRequestPreview[];
};

/** What one finding's assessment attempt produced, sent or withheld. */
type AssessOneFindingOutcome = {
    /** Absent when nothing could be sent; `unassessedReason` then carries why. */
    assessment: FindingAssessment | undefined;
    returnedModel: string | undefined;
    limitations: readonly string[];
    truncated: readonly SemanticScopeExclusion[];
    fromCache: boolean;
    unassessedReason: string;
    /** The request this finding would send; a dry run reports it instead of sending it. */
    preview: SemanticVerifyRequestPreview | undefined;
};

async function assessOneFinding(input: {
    readonly ports: SemanticPorts;
    readonly finding: CandidateFinding;
    readonly context: { readonly mergeBaseSha: string; readonly headSha: string; readonly contractSourceSha: string };
    readonly profile: SemanticBudgetProfile;
    readonly limits: SemanticEvidenceLimits;
    readonly budget: SemanticBudgetController;
    readonly deadline: number;
    readonly dryRun: boolean;
}): Promise<AssessOneFindingOutcome> {
    const set = collectFindingEvidence({
        port: input.ports.source,
        finding: input.finding,
        mergeBaseSha: input.context.mergeBaseSha,
        headSha: input.context.headSha,
        contractSourceSha: input.context.contractSourceSha,
        limits: input.limits,
    });
    if (set.references.length === 0) {
        // Returned rather than thrown: the reason a region was withheld belongs in the report, and a
        // thrown failure would reduce it to a bare code.
        return withheldOutcome({
            finding: input.finding,
            dryRun: input.dryRun,
            cause: nothingSentReason(set.truncated),
            limitations: set.limitations,
            truncated: set.truncated,
        });
    }
    // What the collector admitted is not yet what one request can carry: the state ceiling bounds the
    // regions plus the questions together, so the collected set is fitted to the payload before it is
    // sent, and every region this drops is disclosed exactly as the per-region gate discloses one.
    const fitted = fitFindingEvidence({
        finding: input.finding,
        set,
        maxStatePlusQuestionBytes: input.profile.maxStatePlusQuestionBytes,
    });
    const truncated = [...set.truncated, ...fitted.truncated];
    const limitations = [...set.limitations, ...fitted.limitations];
    if (fitted.references.length === 0) {
        // The reason comes from why, through the same rule the collector's empty case uses: a request
        // that could not carry the regions is a size cause, and a record holding any other cause reads
        // as inadmissible.
        return withheldOutcome({
            finding: input.finding,
            dryRun: input.dryRun,
            cause: nothingSentReason(truncated),
            limitations,
            truncated,
        });
    }
    assertEvidenceIntegrity(fitted.references);
    const supplied = new Set(fitted.references.map((reference) => reference.evidenceId));
    // One construction for the request and its preview, so what a dry run reports is byte for byte
    // what a live run would send.
    const payload = findingRequestPayload(input.finding, fitted);
    const preview = verifyRequestPreview(input.finding.findingId, payload, TYPESAFE_MODEL);
    if (input.dryRun) {
        // The request is genuinely built — collected, fitted, and integrity-checked — then reported
        // instead of sent, under the dry-run omission the report's arithmetic reads.
        return {
            assessment: undefined,
            returnedModel: undefined,
            limitations,
            truncated,
            fromCache: false,
            unassessedReason: DRY_RUN_REASON,
            preview,
        };
    }
    const result = await assessUnit({
        port: input.ports.provider,
        cache: input.ports.cache,
        budget: input.budget,
        profile: input.profile,
        deadline: input.deadline,
        state: payload.state,
        questions: payload.questions,
        requestedModel: TYPESAFE_MODEL,
        signal: input.ports.signal,
        now: input.ports.clock.now,
    });
    const answers = result.response.answers;
    const selectedId = readSelectedEvidenceId(answers.strongestEvidence, supplied);
    return {
        assessment: interpretFinding({
            findingId: input.finding.findingId,
            severityCategory: input.finding.claimedImpactCategory ?? 'unclassified',
            // The fitted drops are part of what the finding was not given, or the assessment would read
            // as though a region it never received had been supplied.
            missingEvidence: [
                ...new Set([
                    ...set.excluded.map((entry) => `${entry.path} (${entry.reason})`),
                    ...truncated.map((entry) => `${entry.path} (${entry.reason})`),
                ]),
            ],
            answers: { support: answers.support, attribution: answers.attribution, kind: answers.kind },
            strongestEvidenceIds: selectedId === NO_EVIDENCE_ID ? [] : [selectedId],
        }),
        returnedModel: result.response.model,
        limitations,
        truncated,
        fromCache: result.fromCache,
        unassessedReason: '',
        preview,
    };
}

/**
 * Assesses every candidate finding under one shared budget. A finding whose evidence cannot be
 * gathered is recorded as unassessed with its reason rather than silently dropped.
 */
async function assessFindings(input: {
    readonly ports: SemanticPorts;
    readonly findings: readonly CandidateFinding[];
    readonly context: { readonly mergeBaseSha: string; readonly headSha: string; readonly contractSourceSha: string };
    readonly profile: SemanticBudgetProfile;
    readonly limits: SemanticEvidenceLimits;
    readonly budget: SemanticBudgetController;
    readonly deadline: number;
    readonly dryRun: boolean;
}): Promise<VerifyAccumulation> {
    const accumulation: VerifyAccumulation = {
        assessments: [],
        unassessed: [],
        returnedModels: new Set<string>(),
        assessed: 0,
        cacheHits: 0,
        failureCode: undefined,
        limitations: [],
        truncated: [],
        previews: [],
    };
    for (const finding of input.findings) {
        try {
            const outcome = await assessOneFinding({
                ports: input.ports,
                finding,
                context: input.context,
                profile: input.profile,
                limits: input.limits,
                budget: input.budget,
                deadline: input.deadline,
                dryRun: input.dryRun,
            });
            accumulation.limitations.push(...outcome.limitations);
            accumulation.truncated.push(...outcome.truncated);
            if (outcome.preview !== undefined) {
                accumulation.previews.push(outcome.preview);
            }
            if (outcome.assessment === undefined) {
                accumulation.unassessed.push({ path: finding.findingId, reason: outcome.unassessedReason });
                continue;
            }
            accumulation.assessments.push(outcome.assessment);
            accumulation.assessed += 1;
            if (outcome.fromCache) {
                accumulation.cacheHits += 1;
            } else if (outcome.returnedModel !== undefined) {
                accumulation.returnedModels.add(outcome.returnedModel);
            }
        } catch (error) {
            const failure = asFailure(error);
            accumulation.failureCode = failure.code;
            accumulation.unassessed.push({ path: finding.findingId, reason: failure.code });
            input.ports.log(
                `semantic verify: finding ${finding.findingId} was not assessed (${failure.code}): ${failure.message}`
            );
        }
    }
    return accumulation;
}

export async function runVerify(input: RunVerifyInput): Promise<RunVerifyResult> {
    const startedAt = new Date(input.ports.clock.now()).toISOString();
    const rulesDigest = computeVerifyQuestionsDigest(input.findings);
    const context = buildRevisionContext({
        ...input.revision,
        evidenceProfile: input.profile.name,
        rulesDigest,
        policyVersion: SEMANTIC_POLICY_VERSION,
    });
    // Identity first: a duplicate id makes the report this run would write unmatchable to its own
    // findings, so it is refused before the collector, the cache, or any provider call is reached.
    assertFindingIdsAreDistinct(input.findings);
    assertFindingsBoundToHead(input.findings, context.headSha);
    // Collection, the provider request, and the budget controller all run under the profile's verify
    // budgets, so a region the collector admits is one the request can carry and the run's stated
    // byte ceiling is the one actually enforced. The scan-sized request budgets would withhold a
    // finding's referenced regions and starve its questions into abstaining for want of evidence.
    const profile: SemanticBudgetProfile = {
        ...input.profile,
        maxStatePlusQuestionBytes: input.profile.verify.maxStatePlusQuestionBytes,
        maxRequestBytes: input.profile.verify.maxRequestBytes,
        maxTotalSubmittedBytes: input.profile.verify.maxTotalSubmittedBytes,
    };
    const limits: SemanticEvidenceLimits = {
        maxRegionBytes: profile.verify.maxRegionBytes,
        maxTotalBytes: profile.verify.maxTotalSubmittedBytes,
    };
    const budget = createBudgetController(profile);
    const deadline = input.ports.clock.now() + profile.overallDeadlineMs;
    const outcome = await assessFindings({
        ports: input.ports,
        findings: input.findings,
        context,
        profile,
        limits,
        budget,
        deadline,
        dryRun: input.dryRun,
    });

    const usage = budget.totals();
    const completedAt = new Date(input.ports.clock.now()).toISOString();
    const { assessments, unassessed, returnedModels, assessed, cacheHits, failureCode, limitations, truncated } =
        outcome;
    const execution = executionState({
        dryRun: input.dryRun,
        assessed,
        eligible: input.findings.length,
        failureCode,
        truncatedCount: truncated.length,
    });
    const report: SemanticVerifyReport = {
        schemaVersion: SEMANTIC_REPORT_FORMAT,
        mode: 'verify',
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
        scope: {
            discovered: input.findings.length,
            eligible: input.findings.length,
            assessed,
            cacheHits,
            excluded: [],
            unassessed,
            truncated: [...truncated],
        },
        findingAssessments: assessments,
        limitations,
        usage: usageReport(usage),
        publication: { state: 'not_requested' },
        failureCode,
    };
    return { report, previews: outcome.previews };
}

function readSelectedEvidenceId(value: unknown, supplied: ReadonlySet<string>): string {
    // The scan path refuses a malformed answer rather than defaulting it, and a silent default here
    // would record "no evidence chosen" for an answer that was never validly given. The other three
    // answers refuse a non-object through `readChoiceAnswer`, so a missing or non-object
    // strongest-evidence answer must refuse too rather than read as a deliberate `none`.
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', 'strongest-evidence answer must be an object');
    }
    const record = value as Record<string, unknown>;
    const choice = record.choice;
    if (typeof choice !== 'string') {
        refuse('invalid_response', 'strongest-evidence answer must select a supplied evidence id or none');
    }
    if (choice !== NO_EVIDENCE_ID && !supplied.has(choice)) {
        refuse('invalid_response', `strongest-evidence answer selected unknown evidence id ${choice}`);
    }
    return choice;
}
