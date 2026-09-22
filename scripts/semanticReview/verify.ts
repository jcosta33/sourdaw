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
    assertLineRange,
    buildRevisionContext,
    isEvidenceSide,
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
    evidenceSidePrefix,
    isSensitivePath,
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
import { computePolicyDigest, type SemanticBudgetProfile } from './rules.ts';
import { asFailure, executionState, usageReport, type SemanticPorts } from './run.ts';
import { sensitiveContentReason } from './sensitive.ts';

import type { SemanticVerifyReport } from './report.ts';

export type CandidateFindingEvidence = {
    readonly path: string;
    readonly side: EvidenceReference['side'];
    /** The range the finding is about. A finding that names no range asks about the whole file. */
    readonly startLine: number;
    readonly endLine: number;
};

export type CandidateFinding = {
    readonly findingId: string;
    readonly headSha: string;
    readonly claim: string;
    readonly allegedFailureInputOrState?: string;
    readonly expectedBehavior: string;
    readonly allegedObservedBehavior?: string;
    readonly evidenceReferences: readonly CandidateFindingEvidence[];
    /** Reported observations and verified execution evidence are kept distinct. */
    readonly reproductionReferences?: readonly {
        readonly path: string;
        readonly note: string;
        readonly verifiedExecution: boolean;
    }[];
    readonly claimedImpactCategory?: string;
};

/** The same shape while it is being assembled field by field from untrusted input. */
type MutableCandidateFinding = {
    findingId: string;
    headSha: string;
    claim: string;
    expectedBehavior: string;
    evidenceReferences: CandidateFindingEvidence[];
    allegedFailureInputOrState?: string;
    allegedObservedBehavior?: string;
    reproductionReferences?: { path: string; note: string; verifiedExecution: boolean }[];
    claimedImpactCategory?: string;
};

export function parseCandidateFindings(value: unknown, label: string): CandidateFinding[] {
    if (!Array.isArray(value)) {
        refuse('unsupported_scope', `${label} must be an array of candidate findings`);
    }
    return value.map((entry, index) => {
        const at = `${label}[${String(index)}]`;
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            refuse('unsupported_scope', `${at} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.findingId !== 'string' || record.findingId.trim() === '') {
            refuse('unsupported_scope', `${at}.findingId must be a non-empty string`);
        }
        if (typeof record.headSha !== 'string' || record.headSha.trim() === '') {
            refuse('unsupported_scope', `${at}.headSha must be a non-empty string`);
        }
        if (typeof record.claim !== 'string' || record.claim.trim() === '') {
            refuse('unsupported_scope', `${at}.claim must be a non-empty string`);
        }
        if (typeof record.expectedBehavior !== 'string' || record.expectedBehavior.trim() === '') {
            refuse('unsupported_scope', `${at}.expectedBehavior must be a non-empty string`);
        }
        if (!Array.isArray(record.evidenceReferences)) {
            refuse('unsupported_scope', `${at}.evidenceReferences must be an array`);
        }
        const evidenceReferences = (record.evidenceReferences as unknown[]).map((reference, referenceIndex) => {
            const refLabel = `${at}.evidenceReferences[${String(referenceIndex)}]`;
            if (typeof reference !== 'object' || reference === null || Array.isArray(reference)) {
                refuse('unsupported_scope', `${refLabel} must be an object`);
            }
            const ref = reference as Record<string, unknown>;
            const path = ref.path;
            const side = ref.side;
            if (typeof path !== 'string' || path.trim() === '') {
                refuse('unsupported_scope', `${refLabel}.path must be a non-empty string`);
            }
            if (!isEvidenceSide(side)) {
                refuse('unsupported_scope', `${refLabel}.side must be before, after, or context`);
            }
            // The caller named the range it is asking about, and dropping the bounds sent the whole
            // file: a finding about lines 10-20 egressed all of it and was assessed over a scope
            // wider than the one it named.
            const startLine = ref.startLine;
            const endLine = ref.endLine;
            if (startLine === undefined || endLine === undefined) {
                refuse('unsupported_scope', `${refLabel} must name startLine and endLine`);
            }
            assertLineRange(startLine, endLine, refLabel);
            if (typeof startLine !== 'number' || typeof endLine !== 'number') {
                refuse('unsupported_scope', `${refLabel} must name a numeric startLine and endLine`);
            }
            return { path, side, startLine, endLine };
        });
        if (evidenceReferences.length === 0) {
            refuse('unsupported_scope', `${at}.evidenceReferences must not be empty`);
        }
        const finding: MutableCandidateFinding = {
            findingId: record.findingId,
            headSha: record.headSha,
            claim: record.claim,
            expectedBehavior: record.expectedBehavior,
            evidenceReferences,
        };
        if (typeof record.allegedFailureInputOrState === 'string') {
            finding.allegedFailureInputOrState = record.allegedFailureInputOrState;
        }
        if (typeof record.allegedObservedBehavior === 'string') {
            finding.allegedObservedBehavior = record.allegedObservedBehavior;
        }
        if (Array.isArray(record.reproductionReferences)) {
            finding.reproductionReferences = (record.reproductionReferences as unknown[]).map((entry) => {
                const ref = entry as Record<string, unknown>;
                return {
                    path: typeof ref.path === 'string' ? ref.path : '',
                    note: typeof ref.note === 'string' ? ref.note : '',
                    verifiedExecution: ref.verifiedExecution === true,
                };
            });
        }
        if (typeof record.claimedImpactCategory === 'string') {
            finding.claimedImpactCategory = record.claimedImpactCategory;
        }
        return finding;
    });
}

/** A finding bound to another head is refused: its assessment cannot be current advice. */
export function assertFindingsBoundToHead(findings: readonly CandidateFinding[], headSha: string): void {
    for (const finding of findings) {
        if (finding.headSha !== headSha) {
            refuse('stale_context', `finding ${finding.findingId} is bound to head ${finding.headSha}, not ${headSha}`);
        }
    }
}

/**
 * The static wording of the verification questions. Digested separately from the scan rules because a
 * verify report's dispositions come from these questions, not from `SEMANTIC_RULES`; recording the
 * scan digest on a verify report named a question set that did not produce it.
 */
const VERIFY_QUESTION_SPEC = {
    support: {
        instructions:
            'Does the supplied implementation evidence support the claim? The expected behavior is stated in the finding. Judge only from the supplied regions; reported observations are not verified execution.',
        criteria: {
            supported: 'The supplied evidence supports the claim and its expected behavior.',
            contradicted: 'The supplied evidence shows the claim is not correct as stated.',
            insufficient_context: 'The supplied evidence is not enough to decide.',
        },
    },
    attribution: {
        instructions:
            'Was the condition the claim describes introduced by the supplied change, or did it already exist at the before side?',
        criteria: {
            introduced_by_change: 'The after-side evidence shows the condition arising from the change.',
            pre_existing: 'The before-side evidence already shows the same condition.',
            undetermined: 'The supplied evidence cannot distinguish the two.',
        },
    },
    kind: {
        instructions:
            'Does the claim describe behavioral or contractual harm, or a style preference with no behavior or contract consequence?',
        criteria: {
            behavioral_or_contract_issue: 'The claim names behavior or a contract that changes.',
            style_preference: 'The claim is about presentation, naming, or preference only.',
            undetermined: 'The supplied evidence cannot decide.',
        },
    },
    strongestEvidence: {
        instructions: 'Which single supplied region is the strongest evidence for your answers above?',
    },
} as const;

/**
 * The identity of the questions a verify report's dispositions came from.
 *
 * The static spec is not enough: the questions actually sent interpolate each finding's claim and
 * expected behavior, and the evidence-selection labels are that finding's own ids. Digesting only the
 * spec made two different finding sets share one identity — and one sidecar path, so the second
 * silently overwrote the first.
 */
export function computeVerifyQuestionsDigest(findings: readonly CandidateFinding[]): string {
    return semanticDigest({
        spec: VERIFY_QUESTION_SPEC,
        findings: findings.map((finding) => ({
            findingId: finding.findingId,
            claim: finding.claim,
            expectedBehavior: finding.expectedBehavior,
            // Every field below reaches the model or changes a recorded disposition: the first three
            // are sent in the state, and the category drives `escalate`. Omitting them let two
            // materially different runs share one identity and one sidecar path.
            allegedFailureInputOrState: finding.allegedFailureInputOrState ?? null,
            allegedObservedBehavior: finding.allegedObservedBehavior ?? null,
            reproductionReferences: (finding.reproductionReferences ?? []).map(
                (reference) => `${reference.path}|${reference.note}|${String(reference.verifiedExecution)}`
            ),
            claimedImpactCategory: finding.claimedImpactCategory ?? null,
            evidenceReferences: finding.evidenceReferences.map((reference) => `${reference.side}:${reference.path}`),
        })),
    });
}

function findingQuestions(finding: CandidateFinding, evidenceIds: readonly string[]): Record<string, unknown> {
    const selectionLabels: Record<string, string> = {
        [NO_EVIDENCE_ID]: 'No supplied region is the strongest evidence.',
    };
    for (const id of evidenceIds) {
        selectionLabels[id] = `Region ${id} is the strongest evidence for this finding.`;
    }
    return {
        support: {
            type: 'choice',
            instructions: `${VERIFY_QUESTION_SPEC.support.instructions} The claim is "${finding.claim}" and the expected behavior is "${finding.expectedBehavior}".`,
            criteria: VERIFY_QUESTION_SPEC.support.criteria,
        },
        attribution: {
            type: 'choice',
            instructions: VERIFY_QUESTION_SPEC.attribution.instructions,
            criteria: VERIFY_QUESTION_SPEC.attribution.criteria,
        },
        kind: {
            type: 'choice',
            instructions: VERIFY_QUESTION_SPEC.kind.instructions,
            criteria: VERIFY_QUESTION_SPEC.kind.criteria,
        },
        strongestEvidence: {
            type: 'choice',
            instructions: VERIFY_QUESTION_SPEC.strongestEvidence.instructions,
            criteria: selectionLabels,
        },
    };
}

function findingState(finding: CandidateFinding, set: SemanticEvidenceSet): Record<string, unknown> {
    const regions: Record<string, unknown> = {};
    for (const reference of set.references) {
        regions[reference.evidenceId] = {
            path: reference.path,
            side: reference.side,
            revisionSha: reference.revisionSha,
            startLine: reference.startLine,
            endLine: reference.endLine,
            content: set.contents.get(reference.evidenceId) ?? '',
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
            truncated.push({ path: reference.path, reason: 'evidence-withheld-sensitive-path' });
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
            truncated.push({ path: reference.path, reason: 'evidence-withheld-credential-shaped' });
            limitations.push(`finding evidence ${reference.path} was withheld: it contains ${unsafe}`);
            continue;
        }
        // The finding named a range, so the range is what leaves the machine. Reading and hashing the
        // whole file sent a scope wider than the one the caller asked about, and reported bounds the
        // request never used. The screen above still judges the whole file, because withholding has to
        // be decided on everything the file holds rather than on the part being quoted.
        const lines = text.split('\n');
        const lastLine = Math.max(1, lines.length);
        const startLine = Math.min(Math.max(1, reference.startLine), lastLine);
        const endLine = Math.min(Math.max(startLine, reference.endLine), lastLine);
        const region = lines.slice(startLine - 1, endLine).join('\n');
        const evidenceId = `${evidenceSidePrefix(reference.side)}${String(ordinal)}`;
        const evidenceReference: EvidenceReference = {
            evidenceId,
            revisionSha: revision,
            path: reference.path,
            side: reference.side,
            startLine,
            endLine,
            contentHash: semanticDigest({ region }),
        };
        // A region is supplied whole or not at all, exactly as the scan path's admission does. Sending
        // it and then naming it truncated made `interpretFinding` read evidence it had been given as
        // missing, while the region still left the machine past the per-region budget the scan path
        // enforces. An oversized region is withheld and named with the scan path's own reason. The gate
        // costs the serialized bytes the fitter uses, not the raw bytes: JSON escapes every newline, so
        // a raw-byte estimate admitted a region the provider then refused, recording a run-wide
        // `budget_exhausted` failure instead of the per-region limitation.
        if (regionCost(evidenceReference, region) > input.limits.maxRegionBytes) {
            truncated.push({
                path: reference.path,
                reason: `region-exceeds-per-region-budget (${reference.side})`,
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
    readonly limits: SemanticEvidenceLimits;
    readonly findings: readonly CandidateFinding[];
    readonly runId: string;
};

export type RunVerifyResult = {
    readonly report: SemanticVerifyReport;
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
};

async function assessOneFinding(input: {
    readonly ports: SemanticPorts;
    readonly finding: CandidateFinding;
    readonly context: { readonly mergeBaseSha: string; readonly headSha: string; readonly contractSourceSha: string };
    readonly profile: SemanticBudgetProfile;
    readonly limits: SemanticEvidenceLimits;
    readonly budget: SemanticBudgetController;
    readonly deadline: number;
}): Promise<{
    /** Absent when nothing admissible could be collected; the limitations then carry the reason. */
    assessment: FindingAssessment | undefined;
    returnedModel: string | undefined;
    limitations: readonly string[];
    truncated: readonly SemanticScopeExclusion[];
    fromCache: boolean;
}> {
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
        return {
            assessment: undefined,
            returnedModel: undefined,
            limitations: set.limitations,
            truncated: set.truncated,
            fromCache: false,
        };
    }
    assertEvidenceIntegrity(set.references);
    const supplied = new Set(set.references.map((reference) => reference.evidenceId));
    const result = await assessUnit({
        port: input.ports.provider,
        cache: input.ports.cache,
        budget: input.budget,
        profile: input.profile,
        deadline: input.deadline,
        state: findingState(input.finding, set),
        questions: findingQuestions(input.finding, [...supplied]),
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
            missingEvidence: [
                ...new Set([
                    ...set.excluded.map((entry) => `${entry.path} (${entry.reason})`),
                    ...set.truncated.map((entry) => `${entry.path} (${entry.reason})`),
                ]),
            ],
            answers: { support: answers.support, attribution: answers.attribution, kind: answers.kind },
            strongestEvidenceIds: selectedId === NO_EVIDENCE_ID ? [] : [selectedId],
        }),
        returnedModel: result.response.model,
        limitations: set.limitations,
        truncated: set.truncated,
        fromCache: result.fromCache,
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
            });
            accumulation.limitations.push(...outcome.limitations);
            accumulation.truncated.push(...outcome.truncated);
            if (outcome.assessment === undefined) {
                accumulation.unassessed.push({ path: finding.findingId, reason: 'no-admissible-evidence' });
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
    assertFindingsBoundToHead(input.findings, context.headSha);
    const budget = createBudgetController(input.profile);
    const deadline = input.ports.clock.now() + input.profile.overallDeadlineMs;
    const outcome = await assessFindings({
        ports: input.ports,
        findings: input.findings,
        context,
        profile: input.profile,
        limits: input.limits,
        budget,
        deadline,
    });

    const usage = budget.totals();
    const completedAt = new Date(input.ports.clock.now()).toISOString();
    const { assessments, unassessed, returnedModels, assessed, cacheHits, failureCode, limitations, truncated } =
        outcome;
    const execution = executionState({
        dryRun: false,
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
    return { report };
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
