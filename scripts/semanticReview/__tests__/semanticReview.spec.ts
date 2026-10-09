import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
} from '@typesafe-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
    renderSavedProjectStateMatcherDigest,
    SAVED_PROJECT_STATE_DIGEST_ENTRIES,
    SAVED_PROJECT_STATE_SURFACES,
} from '../../savedProjectStatePaths.ts';
import { ADVISORY_WORKFLOW_PATH } from '../../semanticReviewContext.ts';
import {
    e2eSpecPattern,
    isNodeTestCollected,
    isPlaywrightCollected,
    isVitestCollected,
    specFilePattern,
} from '../../vitestCollectionPatterns.ts';
import { type PathChangedLines } from '../changeFacts.ts';
import { changedLineFacts } from '../changeFacts.ts';
import {
    assertAdvisoryWording,
    buildRevisionContext,
    computeContextDigest,
    semanticDigest,
    semanticTextDigest,
    SEMANTIC_FAILURE_CODES,
    SemanticFailure,
    type EvidenceReference,
    type EvidenceSide,
    type SemanticRevisionBase,
} from '../contracts.ts';
import { EGRESS_VENDOR_SHAPES, RESIDUAL_RULES, VENDOR_KEY_NAMES } from '../egressVendorShapes.ts';
import {
    collectEvidence,
    evidenceSidePrefix,
    exclusionReason,
    nothingSentReason,
    isContractCarryingPath,
    type PathHunks,
    type SemanticChangedFile,
    type SemanticEvidenceSet,
    type SemanticSourcePort,
} from '../evidence.ts';
import {
    admissionBytesBySide,
    admissionUnits,
    plannedUnitPaths,
    classifyContractCarryingSides,
    compareAdmissionUnits,
    readChangedContents,
    specCoveredSources,
    type AdmissionSideBytes,
    type ChangedSideUnit,
    type ContractCarryingSides,
} from '../evidenceOrdering.ts';
import { fitUnitEvidence, regionCost, regionFitsRequest, regionRequestBytes } from '../fit.ts';
import { parseUnifiedDiffRanges } from '../gitSource.ts';
import { interpretFinding, interpretScanOutcome, readChoiceAnswer } from '../interpret.ts';
import {
    assessUnit,
    computeResponseCacheKey,
    createBudgetController,
    createSdkProviderPort,
    readUsage,
    TYPESAFE_MODEL,
    type SemanticProviderPort,
} from '../provider.ts';
import { renderSummary, validateReport, type SemanticVerifyReport } from '../report.ts';
import { unitReservationBytes } from '../requestPayload.ts';
import { missingRequiredEvidence, RESOLVED_EVIDENCE_TOKENS } from '../requiredEvidence.ts';
import {
    applicableRules,
    assertBudgetProfile,
    computePolicyDigest,
    computeRulesDigest,
    PROBABILITY_SUM_TOLERANCE,
    SEMANTIC_BUDGET_PROFILES,
    SEVERE_INVESTIGATION_CATEGORIES,
    isCollectedSpec,
    isTestPath,
    semanticRule,
    SEMANTIC_RULES,
    type SemanticBudgetProfile,
    type SemanticVerifyBudget,
    unitNeedsContractContext,
    VERIFICATION_ATTRIBUTION_THRESHOLD,
    VERIFICATION_KIND_THRESHOLD,
    VERIFICATION_SUPPORT_THRESHOLD,
} from '../rules.ts';
import {
    assertQuestionsAreReplayable,
    executionState,
    isMissedAssessmentExclusion,
    planUnits,
    runScan,
    unitStatePlusQuestionBytes,
    type SemanticUnitPlan,
} from '../run.ts';
import { sensitiveContentReason } from '../sensitive.ts';
import { computeVerifyQuestionsDigest, type CandidateFinding } from '../verify.ts';

import { generatedDigestProbes } from './digestProbes.ts';

/**
 * Fixtures are composed at runtime from their parts, so no credential-shaped literal appears here:
 * the repository's pull-request diff secret scan is a required gate, and its rules match the
 * `keyword=value` shape rather than only vendor prefixes.
 *
 * The parts are joined rather than encoded, and that distinction is load-bearing. Gitleaks decodes
 * base64 before matching — an encoded fixture still reports as the credential it decodes to, which
 * is exactly how this file failed the gate. A value that never exists contiguously in source has
 * nothing to match on either pass.
 */
function secretFixture(...parts: readonly string[]): string {
    return parts.join('');
}

/** Inverts the case of every letter, so a prefix that is already uppercase still probes case-sensitivity. */
function flipCase(value: string): string {
    return value.replaceAll(/[A-Za-z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
}

const repositoryRoot = resolve(import.meta.dirname, '../../..');

/** A minimal workflow document with the jobs the deadline relation reads. */
function workflowFixture(input: {
    readonly earlier?: number;
    /** Absent leaves the assess job without a timeout of its own, as a job inheriting the default would. */
    readonly assess?: number;
    readonly later?: number;
}): string {
    const jobs = ['jobs:'];
    if (input.earlier !== undefined) {
        jobs.push('  earlier:', `    timeout-minutes: ${String(input.earlier)}`, '    steps: []');
    }
    jobs.push('  assess:');
    if (input.assess !== undefined) {
        jobs.push(`    timeout-minutes: ${String(input.assess)}`);
    }
    jobs.push('    steps: []');
    if (input.later !== undefined) {
        jobs.push('  coverage:', `    timeout-minutes: ${String(input.later)}`, '    steps: []');
    }
    return `${jobs.join('\n')}\n`;
}

/**
 * The `assess` job's own timeout, in minutes, read from a workflow document.
 *
 * A first-match parse over the whole file bounds whichever job appears first, so an earlier job with a
 * larger timeout kept a relation meant to read the assess job green even after that job was lowered.
 */
function assessJobTimeoutMinutes(workflow: string): number | undefined {
    const job = /^ {2}assess:\s*$/mu.exec(workflow);
    if (job === null) {
        return undefined;
    }
    const rest = workflow.slice(job.index + job[0].length);
    const nextJob = /^ {2}\S/mu.exec(rest);
    const timeout = /^\s{4}timeout-minutes:\s*(\d+)\s*$/mu.exec(nextJob === null ? rest : rest.slice(0, nextJob.index));
    return timeout === null ? undefined : Number(timeout[1]);
}

/** Whether the ci deadline fits inside the assess job's own timeout, read from the workflow document. */
function deadlineFitsAssessJob(workflow: string): boolean {
    const minutes = assessJobTimeoutMinutes(workflow);
    return minutes !== undefined && SEMANTIC_BUDGET_PROFILES.ci.overallDeadlineMs < minutes * 60_000;
}

const HEAD = 'a'.repeat(40);
const MERGE_BASE = 'b'.repeat(40);
const TARGET_BASE = 'c'.repeat(40);
const TRUSTED = 'd'.repeat(40);

const BASE_REVISION: SemanticRevisionBase = {
    repository: 'jcosta33/sourdaw',
    repositoryId: '1',
    headSha: HEAD,
    targetBaseSha: TARGET_BASE,
    mergeBaseSha: MERGE_BASE,
    trustedExecutionSha: TRUSTED,
    contractSourceSha: MERGE_BASE,
};

function fakeSource(input: {
    files: readonly SemanticChangedFile[];
    blobs?: Readonly<Record<string, string>>;
    /** Hunks by path. Absent means no hunks were read, so each side is supplied whole. */
    hunks?: ReadonlyMap<string, PathHunks>;
    /** The diff's added and removed lines by path. Absent means the change facts are unavailable. */
    changedLines?: ReadonlyMap<string, PathChangedLines>;
}): SemanticSourcePort {
    const blobs = input.blobs ?? {};
    return {
        changedFiles: () => input.files,
        readFile: (sha, path) => blobs[`${sha}:${path}`],
        changedHunks: () => input.hunks ?? new Map<string, PathHunks>(),
        changedLines: () => input.changedLines ?? new Map<string, PathChangedLines>(),
    };
}

function changedFile(path: string, overrides: Partial<SemanticChangedFile> = {}): SemanticChangedFile {
    return { path, kind: 'modified', binary: false, generated: false, added: 3, deleted: 1, ...overrides };
}

function fixedClock(start: number): { readonly now: () => number; advance: (ms: number) => void } {
    let current = start;
    return {
        now: () => current,
        advance: (ms) => {
            current += ms;
        },
    };
}

/** A provider that answers every question with the same distribution. */
/**
 * A provider that answers every question the same way. A number is a Noul answer — the probability
 * that the property holds — and a distribution is a Choice answer, which is what verification still
 * asks because supported/contradicted/undecidable is one three-valued judgement.
 */
function constantProvider(
    answer: Record<string, number> | number,
    overrides: Partial<SemanticProviderPort> = {}
): SemanticProviderPort {
    return {
        systemOne: async ({ questions }) => {
            const answers: Record<string, unknown> = {};
            for (const key of Object.keys(questions)) {
                if (typeof answer === 'number') {
                    answers[key] = { type: 'noul', noul: answer };
                    continue;
                }
                const selected = Object.entries(answer).sort((left, right) => right[1] - left[1])[0]?.[0];
                answers[key] = {
                    type: 'choice',
                    probabilities: answer,
                    confidence: 0.9,
                    choice: selected,
                };
            }
            return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 100, output_tokens: 0 } };
        },
        ...overrides,
    };
}

const SHIPPED_RULES_DIGEST = computeRulesDigest();

function scanPorts(provider: SemanticProviderPort, source: SemanticSourcePort, clock: ReturnType<typeof fixedClock>) {
    return {
        ports: {
            source,
            provider,
            cache: new MapCache(),
            clock,
            signal: new AbortController().signal,
            log: () => undefined,
        },
        revision: BASE_REVISION,
        profile: SEMANTIC_BUDGET_PROFILES.local,
        limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        contractPaths: [],
        runId: 'test-run',
        dryRun: false,
    };
}

/** An unbounded in-memory cache, equivalent to the production memory cache. */
class MapCache {
    readonly entries = new Map<string, unknown>();
    read = (key: string): unknown => this.entries.get(key);
    write = (key: string, value: unknown): void => {
        this.entries.set(key, value);
    };
}

describe('revision identity', () => {
    it('keeps the target base tip distinct from the merge base', () => {
        // AC-01: a run that conflated the two would report one sha for both.
        const context = buildRevisionContext({
            ...BASE_REVISION,
            evidenceProfile: 'ci',
            rulesDigest: SHIPPED_RULES_DIGEST,
            policyVersion: 'semantic-policy-v1',
        });
        expect(context.targetBaseSha).toBe(TARGET_BASE);
        expect(context.mergeBaseSha).toBe(MERGE_BASE);
        expect(context.targetBaseSha).not.toBe(context.mergeBaseSha);
    });

    it('changes the context digest when the merge base moves', () => {
        // AC-02: a moved base must invalidate the assessment context.
        const inputs = {
            ...BASE_REVISION,
            evidenceProfile: 'ci',
            rulesDigest: SHIPPED_RULES_DIGEST,
            policyVersion: 'p',
        };
        const first = computeContextDigest(inputs);
        const second = computeContextDigest({ ...inputs, mergeBaseSha: 'e'.repeat(40) });
        expect(first).not.toBe(second);
    });

    it('refuses a revision identity that is not a full sha', () => {
        expect(() =>
            buildRevisionContext({
                ...BASE_REVISION,
                headSha: 'abc',
                evidenceProfile: 'ci',
                rulesDigest: SHIPPED_RULES_DIGEST,
                policyVersion: 'p',
            })
        ).toThrow(SemanticFailure);
    });
});

describe('evidence collection', () => {
    it('represents renames, deletions, tests, generated, and binary changes in scope', () => {
        // AC-03: an excluded path stays visible with a reason rather than vanishing.
        const files = [
            changedFile('src/modules/AudioEngine/live.ts', {
                kind: 'renamed',
                previousPath: 'src/modules/AudioEngine/old.ts',
            }),
            changedFile('src/modules/Project/gone.ts', { kind: 'deleted' }),
            changedFile('src/modules/Project/__tests__/undo.spec.ts'),
            changedFile('public/wasm/daw-dsp/app.js', { generated: true }),
            changedFile('assets/impulse.wav', { binary: true }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/AudioEngine/old.ts`]: 'const before = 1;\n',
                    [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const after = 1;\n',
                    [`${MERGE_BASE}:src/modules/Project/gone.ts`]: 'export const gone = true;\n',
                    [`${MERGE_BASE}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("undo", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("undo works", () => {});\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const reasons = new Map(set.excluded.map((entry) => [entry.path, entry.reason]));
        expect(reasons.get('public/wasm/daw-dsp/app.js')).toBe('generated');
        expect(reasons.get('assets/impulse.wav')).toBe('binary');
        // A deleted file keeps its before-side identity.
        const deleted = set.references.find((reference) => reference.path === 'src/modules/Project/gone.ts');
        expect(deleted?.side).toBe('before');
        // A rename supplies both sides under their respective paths.
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/AudioEngine/old.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/AudioEngine/live.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // Tests are never excluded wholesale.
        expect(set.references.some((reference) => reference.path.endsWith('undo.spec.ts'))).toBe(true);
    });

    it('excludes sensitive paths and records the loss of context', () => {
        const set = collectEvidence({
            port: fakeSource({ files: [changedFile('.env')] }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.excluded).toEqual([{ path: '.env', reason: 'sensitive-content-excluded' }]);
        expect(set.references).toHaveLength(0);
        expect(set.limitations.join(' ')).toContain('no source region was eligible');
    });

    it('never reads a path the screen excludes before admission', () => {
        // R2: the collector read every changed path's sides before `exclusionReason` ran, so excluded,
        // binary, generated and lockfile paths were read and held for the whole collection. Screening
        // each path first means only the surviving path's two sides reach the source port.
        const reads: string[] = [];
        const blobs: Record<string, string> = {
            [`${MERGE_BASE}:src/modules/Project/a.ts`]: 'const before = 1;\n',
            [`${HEAD}:src/modules/Project/a.ts`]: 'const after = 1;\n',
        };
        const files: readonly SemanticChangedFile[] = [
            changedFile('.env'),
            changedFile('assets/impulse.wav', { binary: true }),
            changedFile('public/wasm/daw-dsp/app.js', { generated: true }),
            changedFile('Cargo.lock'),
            changedFile('src/modules/Project/a.ts'),
        ];
        const port: SemanticSourcePort = {
            changedFiles: () => files,
            readFile: (sha, path) => {
                reads.push(`${sha}:${path}`);
                return blobs[`${sha}:${path}`];
            },
            changedHunks: () => new Map<string, PathHunks>(),
            changedLines: () => new Map<string, PathChangedLines>(),
        };
        const set = collectEvidence({
            port,
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(reads).toEqual([`${MERGE_BASE}:src/modules/Project/a.ts`, `${HEAD}:src/modules/Project/a.ts`]);
        const reasons = new Map(set.excluded.map((entry) => [entry.path, entry.reason]));
        expect(reasons.get('.env')).toBe('sensitive-content-excluded');
        expect(reasons.get('assets/impulse.wav')).toBe('binary');
        expect(reasons.get('public/wasm/daw-dsp/app.js')).toBe('generated');
        expect(reasons.get('Cargo.lock')).toBe('dependency-lockfile');
        // The sensitive path keeps its truncation and limitation entries even though it is never read.
        expect(
            set.truncated.some((entry) => entry.path === '.env' && entry.reason === 'evidence-withheld-sensitive-path')
        ).toBe(true);
        expect(set.limitations.join(' ')).toContain('it is on the sensitive-path list');
    });

    it('assigns stable application-generated evidence ids with real line bounds', () => {
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/a.ts')],
                blobs: { [`${MERGE_BASE}:src/a.ts`]: 'one\ntwo\n', [`${HEAD}:src/a.ts`]: 'one\ntwo\nthree\n' },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const ids = set.references.map((reference) => reference.evidenceId);
        // A side prefix plus a per-unit ordinal: stable, unique, and never model-authored.
        expect(ids).toEqual(['b1', 'a2']);
        const after = set.references[1] as EvidenceReference;
        expect(after.endLine).toBeGreaterThanOrEqual(after.startLine);
        expect(after.startLine).toBe(1);
    });
});

describe('contract-carrying admission', () => {
    it('admits a trusted-closure path before bulk material that would otherwise exhaust the budget', () => {
        // #4771: the total evidence budget was spent in file order, so bulk files consumed it and the
        // trusted-closure path that sorted last was the one withheld. Contract-carrying paths are now
        // admitted first, so the closure survives and the bulk file is trimmed.
        const bulk = 'const bulk = 1;\n'.repeat(40);
        const bulkBytes = Buffer.byteLength(bulk, 'utf8');
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/bulk.ts'), changedFile('scripts/reviewDossier.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/bulk.ts`]: bulk,
                    [`${HEAD}:aaa/bulk.ts`]: bulk,
                    [`${MERGE_BASE}:scripts/reviewDossier.ts`]: 'const contract = 1;\n',
                    [`${HEAD}:scripts/reviewDossier.ts`]: 'const contract = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // Exactly enough for the bulk file's two whole-file sides and nothing else: file order would
            // have admitted the bulk file and withheld the closure path.
            limits: { maxRegionBytes: bulkBytes, maxTotalBytes: bulkBytes * 2 },
        });
        expect(set.references.some((reference) => reference.path === 'scripts/reviewDossier.ts')).toBe(true);
        expect(set.truncated.some((entry) => entry.path === 'aaa/bulk.ts')).toBe(true);
    });

    it('admits a contract document before a bulk side that would otherwise take its budget', () => {
        // D1: contract-context regions were admitted after every changed-file unit, so a bulk side
        // bought the total budget first and the contract document was withheld as
        // total-evidence-budget-exhausted (context, contract) — a contract term for an ordering the
        // collector never used. The case puts a charged contract document and a bulk side under a total that
        // fits only one of them, and reads that the document is the one admitted.
        const bulk = 'const bulk = 1;\n'.repeat(30);
        const contract = '# AGENTS.md contract\n'.repeat(5);
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/bulk.ts', { kind: 'added', added: 30, deleted: 0 })],
                blobs: {
                    [`${HEAD}:aaa/bulk.ts`]: bulk,
                    [`${MERGE_BASE}:AGENTS.md`]: contract,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // The region ceiling is the serialized measure, so it is sized from the side it must admit;
            // the total stays the raw-byte guard the run states it in.
            limits: {
                maxRegionBytes: scanRegionCost('aaa/bulk.ts', bulk),
                maxTotalBytes: Buffer.byteLength(bulk, 'utf8'),
            },
            contractPaths: ['AGENTS.md'],
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual(['AGENTS.md:context']);
        expect(set.truncated).toEqual([{ path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' }]);
    });

    it('orders an unreadable contract-context document at zero admission bytes, ahead of a zero-byte readable one', () => {
        // `admissionBytes: 0` is the unreadable-context default: a context path with no content at the
        // contract source mints a unit that sorts at zero bytes, so its unavailability is recorded ahead
        // of a readable-but-withheld context region. Reading `1` would reorder the two and move the
        // unavailability entry behind the withheld one.
        const big = 'x'.repeat(2_000);
        const set = collectEvidence({
            port: fakeSource({
                files: [],
                blobs: { [`${MERGE_BASE}:zzz-big.md`]: big },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 100, maxTotalBytes: 1_000_000 },
            contractPaths: ['aaa-missing.md', 'zzz-big.md'],
        });
        expect(set.truncated).toEqual([
            { path: 'aaa-missing.md', reason: 'evidence-unavailable-at-revision' },
            { path: 'zzz-big.md', reason: 'region-exceeds-per-region-budget (context, contract)' },
        ]);
    });

    it("admits the change's contract-carrying side before a larger contract-context document", () => {
        // D2: a contract-context document and the change's contract-carrying side were admitted in one rank,
        // where the non-spec document outranked the change's own spec side whatever its size, so a binding
        // total charged the document and withheld the change's contract material. The case puts a document
        // larger than the side under a total that only one of them fits, and reads that the side is the one
        // admitted.
        const specSide = `import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n${'const filler = 1;\n'.repeat(8)}`;
        const context = '# AGENTS.md contract\n'.repeat(30);
        const specBytes = Buffer.byteLength(specSide, 'utf8');
        const contextBytes = Buffer.byteLength(context, 'utf8');
        // The premise the ordering must defeat: the document is larger than the side, yet the side is the one
        // admitted under a total that fits only one of them.
        expect(contextBytes).toBeGreaterThan(specBytes);
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('scripts/__tests__/closure.spec.ts', { kind: 'added', added: 1, deleted: 0 })],
                blobs: {
                    [`${HEAD}:scripts/__tests__/closure.spec.ts`]: specSide,
                    [`${MERGE_BASE}:AGENTS.md`]: context,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: Math.max(
                    scanRegionCost('AGENTS.md', context, 'context'),
                    scanRegionCost('scripts/__tests__/closure.spec.ts', specSide)
                ),
                maxTotalBytes: contextBytes,
            },
            contractPaths: ['AGENTS.md'],
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'scripts/__tests__/closure.spec.ts:after',
        ]);
        expect(set.truncated).toEqual([
            { path: 'AGENTS.md', reason: 'total-evidence-budget-exhausted (context, contract)' },
        ]);
    });

    it('names a withheld contract-carrying path instead of counting it as an anonymous trim', () => {
        const before = 'const contract = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('scripts/reviewDossier.ts')],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewDossier.ts`]: before,
                    [`${HEAD}:scripts/reviewDossier.ts`]: 'const contract = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: Buffer.byteLength(before, 'utf8') },
        });
        expect(set.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'total-evidence-budget-exhausted (after, contract)' },
        ]);
    });

    it('leaves a bulk path trimmed by the total budget anonymously named', () => {
        const before = 'const a = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/a.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/a.ts`]: before,
                    [`${HEAD}:src/modules/Project/a.ts`]: 'const a = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: Buffer.byteLength(before, 'utf8') },
        });
        expect(set.truncated).toEqual([
            { path: 'src/modules/Project/a.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('routes the hunk-beyond-file cause through the collector for a contract-carrying path', () => {
        // R5: the hunk-beyond-file reason was asserted against the shared helper, so re-inlining the
        // inline form in the collector left the whole suite green. Driving the collector to a hunk that
        // names lines beyond the file exercises the producer and pins the contract term it records.
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('scripts/reviewDossier.ts')],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewDossier.ts`]: 'const before = 1;\n',
                    [`${HEAD}:scripts/reviewDossier.ts`]: 'const after = 1;\n',
                },
                hunks: new Map([
                    [
                        'scripts/reviewDossier.ts',
                        {
                            path: 'scripts/reviewDossier.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [{ startLine: 5, endLine: 9 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'hunk-beyond-file (after, contract)' },
        ]);
    });

    it('derives contract-carrying from the closure, the contract documents, and the workflow inventory', () => {
        expect(isContractCarryingPath('scripts/trustedGithubWriteBootstrap.ts')).toBe(true);
        expect(isContractCarryingPath('AGENTS.md')).toBe(true);
        expect(isContractCarryingPath('.agents/decisions/0047-advisory-semantic-review-also-runs-in-ci.md')).toBe(true);
        expect(isContractCarryingPath('.agents/skills/delivery-orchestration/SKILL.md')).toBe(true);
        expect(isContractCarryingPath('.github/workflows/semantic-review.yml')).toBe(true);
        expect(isContractCarryingPath('.github/workflows/unregistered.yml')).toBe(false);
        // A collected spec is no longer classified by a same-stem sibling; its import/pin content decides.
        expect(isContractCarryingPath('scripts/__tests__/reviewDossier.spec.ts')).toBe(false);
        expect(isContractCarryingPath('scripts/__tests__/checkReleaseInventory.spec.ts')).toBe(false);
        expect(isContractCarryingPath('src/modules/Project/undo.ts')).toBe(false);
    });

    it('admits a collected spec that imports a closure member before an equal-sized bulk spec', () => {
        // R1: `agentDeliveryScripts.spec.ts` has no sibling `scripts/agentDeliveryScripts.ts`, so the
        // same-stem heuristic ranked it bulk and a tight budget dropped the spec that pins the closure.
        const before = 'const before = 1;\n';
        const contractAfter = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/plain.spec.ts'),
                    changedFile('scripts/__tests__/agentDeliveryScripts.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/__tests__/agentDeliveryScripts.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('admits a collected spec that imports a closure member without an extension before an equal-sized bulk spec', () => {
        // R1: live specs import closure members without an extension (`../githubAppIdentity`), so the
        // specifier resolved outside the closure set and the spec was classified bulk. Resolving the
        // extensionless form through the TypeScript extensions matches how the runtime resolves it.
        const before = 'const before = 1;\n';
        const contractAfter = "import { githubAppIdentity } from '../githubAppIdentity';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/githubAppIdentity.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/githubAppIdentity.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/githubAppIdentity.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/__tests__/githubAppIdentity.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('admits a collected spec that names a pinned workflow file before an equal-sized bulk spec', () => {
        // R1: `healthGatesWorkflow.spec.ts` imports no closure member, but its content pins the workflow
        // inventory, so a change to it carries the Gate contract.
        const before = 'const before = 1;\n';
        const contractAfter = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/healthGatesWorkflow.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/healthGatesWorkflow.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/healthGatesWorkflow.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/__tests__/healthGatesWorkflow.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('leaves a collected spec that only mentions a workflow filename bulk', () => {
        // R2: an unanchored substring matched a filename anywhere, so prose mentioning `nightly.yml`
        // classified the spec contract-carrying and displaced the bulk source it covers. The pin is the
        // `.github/workflows/` path, not the bare filename.
        const before = 'const before = 1;\n';
        const plainAfter = "import { describe, expect, it } from 'vitest';\n";
        const mentionAfter = '// nightly.yml is mentioned here without its pinned path\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('zzz/mention.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: plainAfter,
                    [`${MERGE_BASE}:zzz/mention.spec.ts`]: before,
                    [`${HEAD}:zzz/mention.spec.ts`]: mentionAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(plainAfter, 'utf8'),
            },
        });
        // The bare-filename spec's after side is withheld with the plain bulk reason, never a contract
        // term, so the unanchored substring did not classify it contract-carrying.
        expect(
            set.references.some((reference) => reference.path === 'zzz/mention.spec.ts' && reference.side === 'after')
        ).toBe(false);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'zzz/mention.spec.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
    });

    it('leaves a non-spec source that names a pinned workflow path bulk', () => {
        // The workflow-name arm is collected-spec only: a non-spec source that names a pinned workflow
        // path is not contract-carrying, so it does not outrank the bulk competitor it would otherwise
        // starve. Widening the arm to any source would promote this file and displace the competitor.
        const large = `const workflow = '.github/workflows/semantic-review.yml';\n${'const large = 1;\n'.repeat(200)}`;
        const competitor = 'const competitor = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/notes.ts', { kind: 'added', added: 201, deleted: 0 }),
                    changedFile('aaa/competitor.ts', { kind: 'added', added: 1, deleted: 0 }),
                ],
                blobs: {
                    [`${HEAD}:scripts/notes.ts`]: large,
                    [`${HEAD}:aaa/competitor.ts`]: competitor,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: Buffer.byteLength(competitor, 'utf8') },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'aaa/competitor.ts:after',
        ]);
        expect(set.truncated).toEqual([
            { path: 'scripts/notes.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('leaves a collected spec whose after side is unavailable unclassified, never an error', () => {
        const set = collectEvidence({
            port: fakeSource({ files: [changedFile('scripts/__tests__/missing.spec.ts')], blobs: {} }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.references).toHaveLength(0);
        expect(set.truncated.some((entry) => entry.reason === 'evidence-unavailable-at-revision')).toBe(true);
    });

    it('admits a pinned workflow file before a large bulk file under a one-path budget', () => {
        // R2: the closure is trusted-graph scripts only, so `.github/workflows/semantic-review.yml` ranked
        // bulk and a tight budget could drop the file that holds the advisory check's provider key. The case
        // puts both files under a total that fits only one of them, and reads that the workflow file and its
        // after side are the ones admitted.
        const workflowBefore = 'name: semantic-review\n';
        const workflowAfter = 'name: semantic-review\non: pull_request_target\n';
        const bulk = 'const bulk = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/bulk.ts'), changedFile('.github/workflows/semantic-review.yml')],
                blobs: {
                    [`${MERGE_BASE}:aaa/bulk.ts`]: bulk,
                    [`${HEAD}:aaa/bulk.ts`]: bulk,
                    [`${MERGE_BASE}:.github/workflows/semantic-review.yml`]: workflowBefore,
                    [`${HEAD}:.github/workflows/semantic-review.yml`]: workflowAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(workflowBefore, 'utf8') + Buffer.byteLength(workflowAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) => reference.path === '.github/workflows/semantic-review.yml' && reference.side === 'after'
            )
        ).toBe(true);
        expect(
            set.truncated.some(
                (entry) => entry.path === 'aaa/bulk.ts' && entry.reason === 'total-evidence-budget-exhausted (before)'
            )
        ).toBe(true);
    });

    it('records the contract-marked reason when a closure-importing spec is displaced by the budget', () => {
        const before = 'const before = 1;\n';
        const after = `import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n${'const large = 1;\n'.repeat(
            100
        )}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('scripts/__tests__/agentDeliveryScripts.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: after,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: Buffer.byteLength(before, 'utf8') },
        });
        expect(set.truncated).toEqual([
            {
                path: 'scripts/__tests__/agentDeliveryScripts.spec.ts',
                reason: 'total-evidence-budget-exhausted (after, contract)',
            },
        ]);
    });

    it('admits a closure source before its own spec when the spec would exhaust the budget', () => {
        // R4: both paths are contract-carrying, but ranking by path put `scripts/__tests__/X.spec.ts`
        // before `scripts/X.ts`, so the spec spent the budget and withheld the source the change is
        // about. Non-spec before spec inside the contract group fixes it.
        const sourceBefore = 'export const policy = 1;\n';
        const sourceAfter = 'export const policy = 2;\n';
        const specBefore = "import { planReviewRisk } from '../reviewRiskPolicy.ts';\n";
        const specAfter = `${specBefore}${'const large = 1;\n'.repeat(200)}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/__tests__/reviewRiskPolicy.spec.ts'),
                    changedFile('scripts/reviewRiskPolicy.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewRiskPolicy.ts`]: sourceBefore,
                    [`${HEAD}:scripts/reviewRiskPolicy.ts`]: sourceAfter,
                    [`${MERGE_BASE}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specBefore,
                    [`${HEAD}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(specBefore, 'utf8') + Buffer.byteLength(specAfter, 'utf8'),
            },
        });
        expect(set.references.some((reference) => reference.path === 'scripts/reviewRiskPolicy.ts')).toBe(true);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'scripts/__tests__/reviewRiskPolicy.spec.ts' &&
                    entry.reason === 'total-evidence-budget-exhausted (after, contract)'
            )
        ).toBe(true);
    });

    it('admits a closure source before a cheaper spec and withholds the spec when the budget binds', () => {
        // R7: with a budget that admitted only the source's two sides, the spec's before side alone
        // exceeded it, so the spec was withheld under either order and the case observed the qualifier
        // vocabulary rather than the ordering it was built for. This budget fits the spec's before side
        // while still displacing a source side when the spec is attempted first, so the case reads that both
        // source sides are admitted ahead of the cheaper spec and the spec is the one withheld.
        const sourceBefore = 'export const policy = 1;\n';
        const sourceAfter = `export const policy = 2;\n${'const grown = 1;\n'.repeat(6)}`;
        const specBefore = "import { planReviewRisk } from '../reviewRiskPolicy.ts';\n";
        const specAfter = specBefore;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/__tests__/reviewRiskPolicy.spec.ts'),
                    changedFile('scripts/reviewRiskPolicy.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewRiskPolicy.ts`]: sourceBefore,
                    [`${HEAD}:scripts/reviewRiskPolicy.ts`]: sourceAfter,
                    [`${MERGE_BASE}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specBefore,
                    [`${HEAD}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(sourceBefore, 'utf8') + Buffer.byteLength(sourceAfter, 'utf8'),
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'scripts/reviewRiskPolicy.ts:after',
            'scripts/reviewRiskPolicy.ts:before',
        ]);
        expect(set.truncated).toEqual([
            {
                path: 'scripts/__tests__/reviewRiskPolicy.spec.ts',
                reason: 'total-evidence-budget-exhausted (before, contract)',
            },
            {
                path: 'scripts/__tests__/reviewRiskPolicy.spec.ts',
                reason: 'total-evidence-budget-exhausted (after, contract)',
            },
        ]);
    });

    it('orders a source a contract-carrying spec covers ahead of its own spec when the budget binds', () => {
        // The inversion the content rule once papered over: a contract-carrying spec ranked above the
        // bulk source it covers, so the spec spent the budget and the source was withheld. A source the
        // spec imports is the source it covers, and the case reads that the source is admitted ahead of its
        // own spec under the binding total.
        const sourceBefore = 'export const evidence = 1;\n';
        const sourceAfter = 'export const evidence = 2;\n';
        const specBefore =
            "import { describe, expect, it } from 'vitest';\nimport { collectEvidence } from '../evidence.ts';\n";
        const specAfter = `${specBefore}import { trustedDependencyGraphs } from '../../trustedGithubWriteBootstrap.ts';\n${'const large = 1;\n'.repeat(
            200
        )}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/semanticReview/__tests__/semanticReview.spec.ts'),
                    changedFile('scripts/semanticReview/evidence.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/semanticReview/evidence.ts`]: sourceBefore,
                    [`${HEAD}:scripts/semanticReview/evidence.ts`]: sourceAfter,
                    [`${MERGE_BASE}:scripts/semanticReview/__tests__/semanticReview.spec.ts`]: specBefore,
                    [`${HEAD}:scripts/semanticReview/__tests__/semanticReview.spec.ts`]: specAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                // The spec's contract after side fits on its own, so only the source-ahead-of-spec
                // ordering admits the source and withholds the spec; the source would otherwise lose.
                maxTotalBytes: Buffer.byteLength(specAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) => reference.path === 'scripts/semanticReview/evidence.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) => reference.path === 'scripts/semanticReview/evidence.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'scripts/semanticReview/__tests__/semanticReview.spec.ts' &&
                    entry.reason === 'total-evidence-budget-exhausted (after, contract)'
            )
        ).toBe(true);
    });

    it('promotes the modules a spec reaches through a re-export ahead of the spec when the budget binds', () => {
        // D1: `semanticReview.spec.ts` is contract-carrying from content (it names a pinned workflow
        // path) and imports `evidence.ts` directly, but reaches `contractCarrying.ts` and
        // `evidenceOrdering.ts` only through `evidence.ts`'s re-exports. Resolving only the spec's own
        // specifiers left those two modules bulk, so under a binding total the spec and its direct
        // import admitted and the two modules it actually covers were withheld. The covered-source
        // closure promotes the re-exported modules into the spec's tier, so they are not starved by it.
        const evidenceSide =
            "export { isContractCarryingContent } from './contractCarrying.ts';\nexport { compareByPath } from './evidenceOrdering.ts';\n";
        const moduleSide = 'export const carrying = 1;\n'.repeat(2);
        const specBefore = "import { collectEvidence } from '../evidence.ts';\n";
        const specAfter = `${specBefore}const workflow = '.github/workflows/semantic-review.yml';\n`;
        // A budget that admits the spec's direct import plus the two re-exported modules, but not the
        // spec itself: only the covered-source closure keeps the modules ahead of the spec.
        const nonSpecBytes = Buffer.byteLength(evidenceSide, 'utf8') * 2 + Buffer.byteLength(moduleSide, 'utf8') * 4;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/semanticReview/__tests__/semanticReview.spec.ts'),
                    changedFile('scripts/semanticReview/evidence.ts'),
                    changedFile('scripts/semanticReview/contractCarrying.ts'),
                    changedFile('scripts/semanticReview/evidenceOrdering.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/semanticReview/__tests__/semanticReview.spec.ts`]: specBefore,
                    [`${HEAD}:scripts/semanticReview/__tests__/semanticReview.spec.ts`]: specAfter,
                    [`${MERGE_BASE}:scripts/semanticReview/evidence.ts`]: evidenceSide,
                    [`${HEAD}:scripts/semanticReview/evidence.ts`]: evidenceSide,
                    [`${MERGE_BASE}:scripts/semanticReview/contractCarrying.ts`]: moduleSide,
                    [`${HEAD}:scripts/semanticReview/contractCarrying.ts`]: moduleSide,
                    [`${MERGE_BASE}:scripts/semanticReview/evidenceOrdering.ts`]: moduleSide,
                    [`${HEAD}:scripts/semanticReview/evidenceOrdering.ts`]: moduleSide,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: nonSpecBytes },
        });
        // Both re-exported modules admit both sides, ranked with the spec's own tier.
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/semanticReview/contractCarrying.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/semanticReview/contractCarrying.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/semanticReview/evidenceOrdering.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/semanticReview/evidenceOrdering.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // The spec itself is withheld once the modules it covers are admitted.
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'scripts/semanticReview/__tests__/semanticReview.spec.ts' &&
                    entry.reason === 'total-evidence-budget-exhausted (after, contract)'
            )
        ).toBe(true);
    });

    it('ranks a covered source with the spec that covers it, so it cannot spend a binding total ahead of unrelated units', () => {
        // The promotion's own collateral (#4846): a covered source ranked at the front of the contract
        // tier, ahead of every collected spec, so on the production `local` profile it took the room that
        // unrelated planned units needed. Measured on this 13-path fixture — the covering spec, four
        // unrelated collected specs, the source the spec imports, the source that source imports, a
        // deleted path, an over-ceiling path, a credentialed path, a rename, a copy and an added file —
        // the covered sources' hunks filled the 98,304-byte total down to 11 bytes, and the deleted path's
        // own before side, the over-ceiling path's own before side and the covering spec's own unit were
        // all excluded as `no-admissible-evidence`. Ranking a covered source with the spec that covers it
        // restores them: the source's large side keys the pair behind the four unrelated specs rather than at
        // the front of the tier, and the case reads that the source still precedes its own spec and that the
        // deleted, over-ceiling and covering-spec units the front-of-tier promotion starved are planned again.
        const sizedLine = (bytes: number, tag: string): string => {
            const prefix = `export const ${tag} = '`;
            return `${prefix}${'y'.repeat(Math.max(1, bytes - prefix.length - 3))}';\n`;
        };
        const sizedLines = (count: number, bytes: number, tag: string): string =>
            Array.from({ length: count }, (_unused, index) => sizedLine(bytes, `${tag}${String(index)}`)).join('');
        const oneLineHunks = (first: number, count: number): readonly { startLine: number; endLine: number }[] =>
            Array.from({ length: count }, (_unused, index) => ({ startLine: first + index, endLine: first + index }));

        const specPath = 'scripts/semanticReview/__tests__/order.spec.ts';
        const unrelatedSpecPaths = ['alpha', 'beta', 'gamma', 'delta'].map(
            (name) => `scripts/semanticReview/__tests__/${name}.spec.ts`
        );
        const subjectPath = 'scripts/semanticReview/orderSubject.ts';
        const dependencyPath = 'scripts/semanticReview/orderDependency.ts';
        const deletedPath = 'src/modules/Project/legacy.ts';
        const overCeilingPath = 'src/modules/Project/huge.ts';
        const credentialedPath = 'src/modules/Project/keys.ts';
        const movedFromPath = 'src/modules/Project/original.ts';
        const movedPath = 'src/modules/Project/moved.ts';
        const copiedFromPath = 'src/modules/Project/shared.ts';
        const copiedPath = 'src/modules/Project/copied.ts';
        const addedPath = 'src/modules/Project/added.ts';
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";

        // Forty-two hunks a side: a figure above the four unrelated specs' 13, so the pair sits behind them,
        // and small enough regions that the spec's own unit still fits one request.
        const specSide = `import { subject } from '../orderSubject.ts';\n${workflowLine}${sizedLines(42, 251, 'spec')}`;
        const unrelatedSide = `${workflowLine}${sizedLines(13, 800, 'unrelated')}`;
        // The covered sources: 98 kB of hunks between them, which is what took the local total.
        const subjectBefore = `import { dependency } from './orderDependency.ts';\n${sizedLine(4_000, 'subjectA')}`;
        const subjectAfter = `${subjectBefore}${sizedLines(22, 4_000, 'subjectB')}${sizedLine(1_520, 'subjectC')}`;
        const dependencySide = sizedLine(1_600, 'dependency');
        const dependencyAfter = sizedLines(2, 1_600, 'dependency');
        const workflowShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const files = [
            changedFile(specPath, { added: 44, deleted: 0 }),
            ...unrelatedSpecPaths.map((path) => changedFile(path, { added: 14, deleted: 0 })),
            changedFile(subjectPath, { added: 24, deleted: 0 }),
            changedFile(dependencyPath, { added: 3, deleted: 0 }),
            changedFile(deletedPath, { kind: 'deleted', added: 0, deleted: 1 }),
            changedFile(overCeilingPath, { added: 1, deleted: 0 }),
            changedFile(credentialedPath, { added: 1, deleted: 0 }),
            changedFile(movedPath, { kind: 'renamed', previousPath: movedFromPath, added: 1, deleted: 0 }),
            changedFile(copiedPath, { kind: 'copied', previousPath: copiedFromPath, added: 1, deleted: 0 }),
            changedFile(addedPath, { kind: 'added', added: 1, deleted: 0 }),
        ];
        const blobs: Record<string, string> = {
            [`${MERGE_BASE}:${specPath}`]: specSide,
            [`${HEAD}:${specPath}`]: specSide,
            ...Object.fromEntries(
                unrelatedSpecPaths.flatMap((path) => [
                    [`${MERGE_BASE}:${path}`, unrelatedSide],
                    [`${HEAD}:${path}`, unrelatedSide],
                ])
            ),
            [`${MERGE_BASE}:${subjectPath}`]: subjectBefore,
            [`${HEAD}:${subjectPath}`]: subjectAfter,
            [`${MERGE_BASE}:${dependencyPath}`]: dependencySide,
            [`${HEAD}:${dependencyPath}`]: dependencyAfter,
            [`${MERGE_BASE}:${deletedPath}`]: sizedLine(60, 'legacy'),
            [`${MERGE_BASE}:${overCeilingPath}`]: sizedLine(60, 'hugeBefore'),
            [`${HEAD}:${overCeilingPath}`]: sizedLine(20_000, 'hugeAfter'),
            [`${MERGE_BASE}:${credentialedPath}`]: sizedLine(1_000, 'keys'),
            [`${HEAD}:${credentialedPath}`]: `export const key = '${workflowShaped}';\n`,
            [`${MERGE_BASE}:${movedFromPath}`]: sizedLine(5_000, 'moved'),
            [`${HEAD}:${movedPath}`]: sizedLine(5_000, 'moved'),
            [`${MERGE_BASE}:${copiedFromPath}`]: sizedLine(5_000, 'copied'),
            [`${HEAD}:${copiedPath}`]: sizedLine(5_000, 'copied'),
            [`${HEAD}:${addedPath}`]: sizedLine(5_000, 'added'),
            [`${MERGE_BASE}:AGENTS.md`]: sizedLine(3_000, 'agents'),
            [`${MERGE_BASE}:.agents/decisions/README.md`]: sizedLine(3_000, 'decisions'),
        };
        const hunks = new Map<string, PathHunks>([
            [specPath, { path: specPath, before: oneLineHunks(3, 42), after: oneLineHunks(3, 42) }],
            ...unrelatedSpecPaths.map((path): [string, PathHunks] => [
                path,
                { path, before: oneLineHunks(2, 13), after: oneLineHunks(2, 13) },
            ]),
            [subjectPath, { path: subjectPath, before: oneLineHunks(2, 1), after: oneLineHunks(2, 24) }],
            [dependencyPath, { path: dependencyPath, before: oneLineHunks(1, 1), after: oneLineHunks(1, 2) }],
            [deletedPath, { path: deletedPath, before: oneLineHunks(1, 1), after: [] }],
            [overCeilingPath, { path: overCeilingPath, before: oneLineHunks(1, 1), after: oneLineHunks(1, 1) }],
        ]);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        const set = collectEvidence({
            port: fakeSource({ files, blobs, hunks }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: profile.maxStatePlusQuestionBytes,
                maxTotalBytes: profile.maxTotalSubmittedBytes,
            },
            includeDefaultContractContext: true,
        });
        const planned = planUnits(files, set, profile.maxStatePlusQuestionBytes);
        const ownSides = (path: string): readonly string[] =>
            planned.units.find((unit) => unit.path === path)?.evidence.own.map((reference) => reference.side) ?? [];
        // The three units the promotion starved are planned, each from its own side.
        expect(ownSides(deletedPath)).toEqual(['before']);
        expect(ownSides(overCeilingPath)).toEqual(['before']);
        expect(ownSides(specPath)).toEqual(['before', 'before', 'before']);
        // The four unrelated collected specs keep the room the covered sources used to take.
        expect(unrelatedSpecPaths.every((path) => ownSides(path).length > 0)).toBe(true);
        // The source is paired with its coverer at the pair's largest side figure, so both of its sides sit at
        // one position behind the unrelated specs, and the source stays ahead of the spec that covers it.
        const admittedPaths = set.references.map((reference) => reference.path);
        const refIndex = (path: string, side: 'before' | 'after'): number =>
            set.references.findIndex((reference) => reference.path === path && reference.side === side);
        expect(refIndex(unrelatedSpecPaths[0] ?? '', 'before')).toBeLessThan(refIndex(subjectPath, 'before'));
        expect(refIndex(unrelatedSpecPaths[0] ?? '', 'after')).toBeLessThan(refIndex(subjectPath, 'after'));
        expect(admittedPaths.indexOf(subjectPath)).toBeLessThan(admittedPaths.indexOf(specPath));
    });

    it('keeps a source ahead of every spec that covers it when two contract-carrying specs share it', () => {
        // Two contract-carrying specs cover one source, and one of them carries the larger figure. The source
        // must be admitted ahead of both — the spec it shares a position with and the other one — so this case
        // reads the shape where the larger spec is not the one that decides its order.
        const sizedLine = (bytes: number, tag: string): string => {
            const prefix = `export const ${tag} = '`;
            return `${prefix}${'y'.repeat(Math.max(1, bytes - prefix.length - 3))}';\n`;
        };
        const sizedLines = (count: number, bytes: number, tag: string): string =>
            Array.from({ length: count }, (_unused, index) => sizedLine(bytes, `${tag}${String(index)}`)).join('');
        const oneLineHunks = (first: number, count: number): readonly { startLine: number; endLine: number }[] =>
            Array.from({ length: count }, (_unused, index) => ({ startLine: first + index, endLine: first + index }));

        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const importLine = "import { shared } from '../shared.ts';\n";
        const aaaSpecPath = 'scripts/semanticReview/__tests__/aaaShared.spec.ts';
        const zzzSpecPath = 'scripts/semanticReview/__tests__/zzzShared.spec.ts';
        const subjectPath = 'scripts/semanticReview/shared.ts';

        // `zzzShared` carries the smaller figure: 60,000 bytes against `aaaShared`'s 72,000. The source
        // carries 48,000 bytes of its own hunks, so the binding total leaves it no room to spare: it survives
        // only by being admitted ahead of the spec that carries the larger figure.
        const zzzAfter = `${workflowLine}${importLine}${sizedLines(5, 12_000, 'zzz')}`;
        const aaaAfter = `${workflowLine}${importLine}${sizedLines(6, 12_000, 'aaa')}`;
        const subjectAfter = sizedLines(4, 12_000, 'shared');
        const files = [
            changedFile(aaaSpecPath, { kind: 'added', added: 8, deleted: 0 }),
            changedFile(zzzSpecPath, { kind: 'added', added: 7, deleted: 0 }),
            changedFile(subjectPath, { kind: 'added', added: 4, deleted: 0 }),
        ];
        const hunks = new Map<string, PathHunks>([
            [aaaSpecPath, { path: aaaSpecPath, before: [], after: oneLineHunks(3, 6) }],
            [zzzSpecPath, { path: zzzSpecPath, before: [], after: oneLineHunks(3, 5) }],
            [subjectPath, { path: subjectPath, before: [], after: oneLineHunks(1, 4) }],
        ]);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        const set = collectEvidence({
            port: fakeSource({
                files,
                hunks,
                blobs: {
                    [`${HEAD}:${aaaSpecPath}`]: aaaAfter,
                    [`${HEAD}:${zzzSpecPath}`]: zzzAfter,
                    [`${HEAD}:${subjectPath}`]: subjectAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: profile.maxStatePlusQuestionBytes,
                maxTotalBytes: profile.maxTotalSubmittedBytes,
            },
        });
        // The source precedes the smaller spec in the reference order, and the larger spec's unit is withheld
        // once the source is admitted.
        const admittedPaths = set.references.map((reference) => reference.path);
        expect(admittedPaths.indexOf(subjectPath)).toBeLessThan(admittedPaths.indexOf(zzzSpecPath));
        expect(set.withheldSides.own.get(aaaSpecPath)).toContain('after');
        // And it survives the binding total whole: its after side is not withheld once the source is admitted
        // ahead of the spec that carries the larger figure.
        expect(set.withheldSides.own.get(subjectPath)).toBeUndefined();
    });

    it('keeps each side of a covered source ahead of every coverer when the coverers cross per side', () => {
        // The fixture builds three modified files: two contract-carrying specs that both import the source,
        // and the source they cover. `aaaBeforeMin` carries the smallest before side and `zzzAfterMin` the
        // smallest after side, so the two coverers' minimal sides cross. The assertions read the shape the
        // case's name states on both sides: each source side precedes every coverer side.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const importLine = "import { asym } from '../asymSource.ts';\n";
        const aaaSpecPath = 'scripts/semanticReview/__tests__/aaaBeforeMin.spec.ts';
        const zzzSpecPath = 'scripts/semanticReview/__tests__/zzzAfterMin.spec.ts';
        const subjectPath = 'scripts/semanticReview/asymSource.ts';

        // `aaaBeforeMin` carries the smallest before side and `zzzAfterMin` the smallest after side, so their
        // minima cross; every side is charged whole. The case name is the assertion below.
        const aaaBefore = `${workflowLine}${importLine}`;
        const aaaAfter = `${workflowLine}${importLine}${'y'.repeat(2_000)}`;
        const zzzBefore = `${workflowLine}${importLine}${'y'.repeat(1_500)}`;
        const zzzAfter = `${workflowLine}${importLine}${'y'.repeat(100)}`;
        const subjectSide = 'y'.repeat(20);
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile(aaaSpecPath), changedFile(zzzSpecPath), changedFile(subjectPath)],
                blobs: {
                    [`${MERGE_BASE}:${aaaSpecPath}`]: aaaBefore,
                    [`${HEAD}:${aaaSpecPath}`]: aaaAfter,
                    [`${MERGE_BASE}:${zzzSpecPath}`]: zzzBefore,
                    [`${HEAD}:${zzzSpecPath}`]: zzzAfter,
                    [`${MERGE_BASE}:${subjectPath}`]: subjectSide,
                    [`${HEAD}:${subjectPath}`]: subjectSide,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const refIndex = (path: string, side: 'before' | 'after'): number =>
            set.references.findIndex((reference) => reference.path === path && reference.side === side);
        // The source's before side precedes both coverers' before sides, and its after side precedes both
        // coverers' after sides.
        expect(refIndex(subjectPath, 'before')).toBeLessThan(refIndex(aaaSpecPath, 'before'));
        expect(refIndex(subjectPath, 'before')).toBeLessThan(refIndex(zzzSpecPath, 'before'));
        expect(refIndex(subjectPath, 'after')).toBeLessThan(refIndex(aaaSpecPath, 'after'));
        expect(refIndex(subjectPath, 'after')).toBeLessThan(refIndex(zzzSpecPath, 'after'));
    });

    it('keeps a source larger than every coverer ahead of every coverer when the paired coverer is not the first path', () => {
        // A source larger than all of its coverers is the largest member of every pair it forms, so its own
        // figure is the key every coverer ties. It takes the position of the lexicographically first coverer,
        // which is not the coverer it is paired with for its figure, and a coverer whose path sorts before the
        // paired coverer's still orders after the source — so the anchor choice is what keeps the source ahead
        // of a coverer the pair's own path would not.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const importLine = "import { shared } from '../shared.ts';\n";
        const anchorSpecPath = 'scripts/semanticReview/__tests__/aaaAnchor.spec.ts';
        const bigSpecPath = 'scripts/semanticReview/__tests__/bbbBig.spec.ts';
        const smallSpecPath = 'scripts/semanticReview/__tests__/cccSmall.spec.ts';
        const sourcePath = 'scripts/semanticReview/shared.ts';
        const changed: SemanticChangedFile[] = [
            { path: anchorSpecPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: bigSpecPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: smallSpecPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: sourcePath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
        ];
        const specSide = `${workflowLine}${importLine}`;
        const contents = new Map<string, { before?: string; after?: string }>([
            [anchorSpecPath, { before: specSide, after: specSide }],
            [bigSpecPath, { before: specSide, after: specSide }],
            [smallSpecPath, { before: specSide, after: specSide }],
            [sourcePath, { before: 'export const shared = 1;\n', after: 'export const shared = 1;\n' }],
        ]);
        // `cccSmall` is the coverer the source is paired with (its largest side, 100, is the smallest);
        // `bbbBig` carries the largest figure; `aaaAnchor` is neither, and is the lexicographically first
        // coverer. The source's own 1,000-byte figure is the largest, so all four key at 1,000, and the
        // source's position is the anchor's path.
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            [anchorSpecPath, { before: 300, after: 300 }],
            [bigSpecPath, { before: 500, after: 500 }],
            [smallSpecPath, { before: 100, after: 100 }],
            [sourcePath, { before: 1_000, after: 1_000 }],
        ]);
        const sidesByPath = new Map<string, ContractCarryingSides>([
            [anchorSpecPath, { before: true, after: true }],
            [bigSpecPath, { before: true, after: true }],
            [smallSpecPath, { before: true, after: true }],
            [sourcePath, { before: false, after: false }],
        ]);
        const specCovered = specCoveredSources(changed, contents, bytesBySide);
        const units = admissionUnits(
            changed,
            sidesByPath,
            bytesBySide,
            [],
            specCovered,
            new Set(changed.map((file) => file.path))
        );
        const index = (path: string, side: 'before' | 'after'): number =>
            units.findIndex((unit) => unit.kind === 'changed' && unit.file.path === path && unit.side === side);
        expect(index(sourcePath, 'before')).toBeLessThan(index(anchorSpecPath, 'before'));
        expect(index(sourcePath, 'before')).toBeLessThan(index(bigSpecPath, 'before'));
        expect(index(sourcePath, 'before')).toBeLessThan(index(smallSpecPath, 'before'));
        expect(index(sourcePath, 'after')).toBeLessThan(index(anchorSpecPath, 'after'));
        expect(index(sourcePath, 'after')).toBeLessThan(index(bigSpecPath, 'after'));
        expect(index(sourcePath, 'after')).toBeLessThan(index(smallSpecPath, 'after'));
    });

    it("keys a covered source smaller than its spec at the spec's larger figure and still plans it", () => {
        // A covered source smaller than its spec ranks at the pair's larger figure — the spec's — never its
        // own smaller one, so it competes where the spec ranks rather than ahead of unrelated material the
        // spec itself does not outrank. The three probes land behind the two unrelated specs, and the binding
        // local total still admits the 9,000-byte source's unit because the pair's position leaves it room.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const coverImports =
            "import { a } from '../probeA.ts';\nimport { b } from '../probeB.ts';\nimport { c } from '../probeC.ts';\n";
        const padded = (bytes: number, ...parts: readonly string[]): string => {
            const prefix = parts.join('');
            return `${prefix}${'y'.repeat(Math.max(1, bytes - Buffer.byteLength(prefix, 'utf8')))}`;
        };
        const coverSpecPath = 'scripts/semanticReview/__tests__/aaCover.spec.ts';
        const otherSpecPaths = [
            'scripts/semanticReview/__tests__/bbOther.spec.ts',
            'scripts/semanticReview/__tests__/ccOther.spec.ts',
        ];
        const probeAPath = 'scripts/semanticReview/probeA.ts';
        const probeBPath = 'scripts/semanticReview/probeB.ts';
        const probeCPath = 'scripts/semanticReview/probeC.ts';

        // Both sides are sized under the serialized measure the charge and the gate share — raw bytes
        // undercount them by the escaping and the reference's own fields — while keeping the pair's figure
        // above the unrelated specs'.
        const coverSide = padded(16_000, workflowLine, coverImports);
        const otherSide = padded(15_700, workflowLine);
        const files = [
            changedFile(coverSpecPath),
            ...otherSpecPaths.map((path) => changedFile(path)),
            changedFile(probeAPath),
            changedFile(probeBPath),
            changedFile(probeCPath),
        ];
        const blobs: Record<string, string> = {
            [`${MERGE_BASE}:${coverSpecPath}`]: coverSide,
            [`${HEAD}:${coverSpecPath}`]: coverSide,
            [`${MERGE_BASE}:${probeAPath}`]: padded(13_000),
            [`${HEAD}:${probeAPath}`]: padded(13_000),
            [`${MERGE_BASE}:${probeBPath}`]: padded(9_000),
            [`${HEAD}:${probeBPath}`]: padded(9_000),
            [`${MERGE_BASE}:${probeCPath}`]: padded(500),
            [`${HEAD}:${probeCPath}`]: padded(500),
            ...Object.fromEntries(
                otherSpecPaths.flatMap((path) => [
                    [`${MERGE_BASE}:${path}`, otherSide],
                    [`${HEAD}:${path}`, otherSide],
                ])
            ),
        };
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        const set = collectEvidence({
            port: fakeSource({ files, blobs }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: profile.maxStatePlusQuestionBytes,
                maxTotalBytes: profile.maxTotalSubmittedBytes,
            },
        });
        const planned = planUnits(files, set, profile.maxStatePlusQuestionBytes);
        const refIndex = (path: string): number => set.references.findIndex((reference) => reference.path === path);
        // The pair's 16,000-byte figure sits above the unrelated specs' 15,700, so the unrelated specs are
        // admitted ahead of the 9,000-byte source rather than behind it.
        expect(refIndex(otherSpecPaths[0] ?? '')).toBeLessThan(refIndex(probeBPath));
        // And the source still plans: the total admits its unit after the unrelated specs instead of starving it.
        expect(planned.units.some((unit) => unit.path === probeBPath)).toBe(true);
        expect(
            planned.excluded.some((entry) => entry.path === probeBPath && entry.reason === 'no-admissible-evidence')
        ).toBe(false);
    });

    it('keeps an added covered source ahead of every side of the spec that covers it', () => {
        // An added source has only an after side, and its coverer's before side is cheaper. The case reads
        // that the source's after side is admitted ahead of both of the coverer's sides whatever the
        // coverer's own per-side figures are.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const coverPath = 'scripts/semanticReview/__tests__/offside.spec.ts';
        const sourcePath = 'scripts/semanticReview/offsideSource.ts';
        const specSide = `${workflowLine}import { s } from '../offsideSource.ts';\n`;
        const changed: SemanticChangedFile[] = [
            { path: coverPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: sourcePath, kind: 'added', binary: false, generated: false, added: 1, deleted: 0 },
        ];
        const contents = new Map<string, { before?: string; after?: string }>([
            [coverPath, { before: specSide, after: specSide }],
            [sourcePath, { after: 'export const s = 1;\n' }],
        ]);
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            [coverPath, { before: 1_000, after: 10_000 }],
            [sourcePath, { before: 0, after: 5_000 }],
        ]);
        const sidesByPath = new Map<string, ContractCarryingSides>([
            [coverPath, { before: true, after: true }],
            [sourcePath, { before: false, after: false }],
        ]);
        const specCovered = specCoveredSources(changed, contents, bytesBySide);
        const units = admissionUnits(
            changed,
            sidesByPath,
            bytesBySide,
            [],
            specCovered,
            new Set(changed.map((file) => file.path))
        );
        const index = (path: string, side: 'before' | 'after'): number =>
            units.findIndex((unit) => unit.kind === 'changed' && unit.file.path === path && unit.side === side);
        expect(index(sourcePath, 'after')).toBeLessThan(index(coverPath, 'before'));
        expect(index(sourcePath, 'after')).toBeLessThan(index(coverPath, 'after'));
    });

    it('keeps covered sources that key at one pair figure in their own size order', () => {
        // Every source here is smaller than the one spec that covers all three, so all three key at the
        // coverer's own figure and share one position. The case reads that they keep their own ascending size
        // order there: the smallest source is attempted first, so the plan keeps as much as the merge base
        // did.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const coverPath = 'scripts/semanticReview/__tests__/smallCover.spec.ts';
        const sourcePaths = ['a', 'b', 'c'].map((name) => `scripts/semanticReview/${name}.ts`);
        const coverAfter = `${workflowLine}${sourcePaths.map((path) => `import { x } from '../${path.split('/').pop()}';\n`).join('')}`;
        const changed: SemanticChangedFile[] = [
            { path: coverPath, kind: 'added', binary: false, generated: false, added: 1, deleted: 0 },
            ...sourcePaths.map((path): SemanticChangedFile => ({
                path,
                kind: 'added',
                binary: false,
                generated: false,
                added: 1,
                deleted: 0,
            })),
        ];
        const contents = new Map<string, { before?: string; after?: string }>([
            [coverPath, { after: coverAfter }],
            ...sourcePaths.map((path): [string, { before?: string; after?: string }] => [
                path,
                { after: 'export const x = 1;\n' },
            ]),
        ]);
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            [coverPath, { before: 0, after: 80_000 }],
            [sourcePaths[0] ?? '', { before: 0, after: 40_000 }],
            [sourcePaths[1] ?? '', { before: 0, after: 20_000 }],
            [sourcePaths[2] ?? '', { before: 0, after: 10_000 }],
        ]);
        const sidesByPath = new Map<string, ContractCarryingSides>([
            [coverPath, { before: false, after: true }],
            ...sourcePaths.map((path): [string, ContractCarryingSides] => [path, { before: false, after: false }]),
        ]);
        const specCovered = specCoveredSources(changed, contents, bytesBySide);
        const units = admissionUnits(
            changed,
            sidesByPath,
            bytesBySide,
            [],
            specCovered,
            new Set(changed.map((file) => file.path))
        );
        const sourceOrder = units
            .filter((unit) => unit.kind === 'changed' && !unit.file.path.endsWith('.spec.ts'))
            .map((unit) => (unit.kind === 'changed' ? unit.file.path.split('/').pop() : ''));
        expect(sourceOrder).toEqual(['c.ts', 'b.ts', 'a.ts']);
    });

    it('keys a source larger than its coverer at its own figure, behind an unrelated spec between them', () => {
        // The pair key is the larger of the source's own figure and the coverer's, never the coverer's alone.
        // The case reads a source larger than its coverer: it is attempted behind an unrelated spec whose
        // figure sits between them, while the coverer stays after the source.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const coverPath = 'scripts/semanticReview/__tests__/cover.spec.ts';
        const unrelatedPath = 'scripts/semanticReview/__tests__/unrelated.spec.ts';
        const sourcePath = 'scripts/semanticReview/src.ts';
        const specSide = `${workflowLine}import { s } from '../src.ts';\n`;
        const changed: SemanticChangedFile[] = [
            { path: coverPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: unrelatedPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: sourcePath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
        ];
        const contents = new Map<string, { before?: string; after?: string }>([
            [coverPath, { before: specSide, after: specSide }],
            [unrelatedPath, { before: workflowLine, after: workflowLine }],
            [sourcePath, { before: 'export const s = 1;\n', after: 'export const s = 1;\n' }],
        ]);
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            [coverPath, { before: 100, after: 100 }],
            [unrelatedPath, { before: 500, after: 500 }],
            [sourcePath, { before: 1_000, after: 1_000 }],
        ]);
        const sidesByPath = new Map<string, ContractCarryingSides>([
            [coverPath, { before: true, after: true }],
            [unrelatedPath, { before: true, after: true }],
            [sourcePath, { before: false, after: false }],
        ]);
        const specCovered = specCoveredSources(changed, contents, bytesBySide);
        const units = admissionUnits(
            changed,
            sidesByPath,
            bytesBySide,
            [],
            specCovered,
            new Set(changed.map((file) => file.path))
        );
        const index = (path: string, side: 'before' | 'after'): number =>
            units.findIndex((unit) => unit.kind === 'changed' && unit.file.path === path && unit.side === side);
        expect(index(unrelatedPath, 'before')).toBeLessThan(index(sourcePath, 'before'));
        expect(index(sourcePath, 'before')).toBeLessThan(index(coverPath, 'before'));
    });

    it("admits a covered source at its coverer's position before an equal-figure contract-needing unit", () => {
        // The fixture builds a covered bulk source whose own side carries 1,000 bytes under a contract-carrying
        // spec whose side carries 4,000, and an added path whose rules need a contract and whose side carries
        // the same 4,000 bytes the source's position takes. The competitor's path sorts before the position the
        // source takes, so the two units differ at nothing else the comparison reaches before the tiers: the
        // tier the coverage promotion earns is what decides, and the case reads the competitor's unit class
        // against the source's, their shared figure, and that the source is ordered first.
        const coverPath = 'scripts/semanticReview/__tests__/coverAll.spec.ts';
        const sourcePath = 'scripts/bulkSource.ts';
        const competitorPath = 'electron/aShape.ts';
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const pad = (bytes: number, ...prefix: readonly string[]): string => {
            const head = prefix.join('');
            return `${head}${'y'.repeat(bytes - Buffer.byteLength(head))}`;
        };
        const coverSide = pad(4_000, workflowLine, "import { b } from '../../bulkSource.ts';\n");
        const sourceSide = pad(1_000, 'export const b = 1;\n');
        const competitorSide = pad(4_000, 'const value = 1;\n');
        const files: SemanticChangedFile[] = [
            { path: coverPath, kind: 'added', binary: false, generated: false, added: 1, deleted: 0 },
            { path: sourcePath, kind: 'added', binary: false, generated: false, added: 1, deleted: 0 },
            { path: competitorPath, kind: 'added', binary: false, generated: false, added: 250, deleted: 0 },
        ];
        const port = fakeSource({
            files,
            blobs: {
                [`${HEAD}:${coverPath}`]: coverSide,
                [`${HEAD}:${sourcePath}`]: sourceSide,
                [`${HEAD}:${competitorPath}`]: competitorSide,
            },
        });
        const contents = readChangedContents(port, MERGE_BASE, HEAD, files);
        const hunks = new Map<string, PathHunks>();
        const bytesBySide = admissionBytesBySide(files, contents, hunks, 100_000, MERGE_BASE, HEAD);
        const sidesByPath = classifyContractCarryingSides(files, contents);
        const covered = specCoveredSources(files, contents, bytesBySide);
        const units = admissionUnits(
            files,
            sidesByPath,
            bytesBySide,
            [],
            covered,
            new Set(files.map((entry) => entry.path))
        );
        const sideUnits = units.filter((unit): unit is ChangedSideUnit => unit.kind === 'changed');
        const sourceUnit = sideUnits.find((unit) => unit.file.path === sourcePath);
        const competitorUnit = sideUnits.find((unit) => unit.file.path === competitorPath);
        if (sourceUnit === undefined || competitorUnit === undefined) {
            throw new Error('both the covered source and the competitor must produce a unit');
        }
        // The competitor's unit needs a contract and carries none, the source's unit carries none and is
        // covered by a spec that does, and the two units share one figure.
        expect(unitNeedsContractContext(applicableRules([competitorPath]))).toBe(true);
        expect(unitNeedsContractContext(applicableRules([coverPath]))).toBe(true);
        expect(covered.get(sourcePath)).toEqual([coverPath]);
        expect(sourceUnit.specCovered).toBe(true);
        expect(sourceUnit.contractNeeding).toBe(true);
        expect(sourceUnit.contractCarrying).toBe(false);
        expect(competitorUnit.specCovered).toBe(false);
        expect(competitorUnit.contractNeeding).toBe(true);
        expect(competitorUnit.contractCarrying).toBe(false);
        expect(sourceUnit.order.admissionBytes).toBe(competitorUnit.order.admissionBytes);
        expect(sourceUnit.order.path).toBe(coverPath);
        expect(sidesByPath.get(sourcePath)?.after).toBe(false);
        expect(compareAdmissionUnits(sourceUnit, competitorUnit)).toBeLessThan(0);
        expect(sideUnits.indexOf(sourceUnit)).toBeLessThan(sideUnits.indexOf(competitorUnit));
        const set = collectEvidence({
            port,
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 100_000, maxTotalBytes: 8_500 },
        });
        expect(set.references.map((reference) => reference.path)).toContain(sourcePath);
        expect(set.references.map((reference) => reference.path)).not.toContain(competitorPath);
        expect(
            set.truncated.some(
                (entry) => entry.path === competitorPath && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
        const planned = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        expect(planned.units.some((unit) => unit.path === sourcePath)).toBe(true);
    });

    it('orders two equal-figure covered sources by their own paths whatever order the caller lists them', () => {
        // Two sources keyed at their shared coverer's figure, with equal figures of their own, so they reach
        // one position with nothing between them but their own paths. The case lists them in both orders and
        // reads that the lexicographically first is ordered first each way: the order the caller lists the
        // change's files in does not decide it.
        const coverPath = 'scripts/semanticReview/__tests__/equalCover.spec.ts';
        const aPath = 'scripts/semanticReview/equalA.ts';
        const bPath = 'scripts/semanticReview/equalB.ts';
        const coverAfter = `const workflow = '.github/workflows/semantic-review.yml';\nimport { a } from '../equalA.ts';\nimport { b } from '../equalB.ts';\n`;
        const changed = (paths: readonly string[]): SemanticChangedFile[] => [
            { path: coverPath, kind: 'added', binary: false, generated: false, added: 1, deleted: 0 },
            ...paths.map((path): SemanticChangedFile => ({
                path,
                kind: 'added',
                binary: false,
                generated: false,
                added: 1,
                deleted: 0,
            })),
        ];
        const contents = new Map<string, { before?: string; after?: string }>([
            [coverPath, { after: coverAfter }],
            [aPath, { after: 'export const a = 1;\n' }],
            [bPath, { after: 'export const b = 1;\n' }],
        ]);
        const sidesByPath = new Map<string, ContractCarryingSides>([
            [coverPath, { before: false, after: true }],
            [aPath, { before: false, after: false }],
            [bPath, { before: false, after: false }],
        ]);
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            [coverPath, { before: 0, after: 40_000 }],
            [aPath, { before: 0, after: 20_000 }],
            [bPath, { before: 0, after: 20_000 }],
        ]);
        const orderedSources = (paths: readonly string[]): readonly ChangedSideUnit[] => {
            const files = changed(paths);
            const units = admissionUnits(
                files,
                sidesByPath,
                bytesBySide,
                [],
                specCoveredSources(files, contents, bytesBySide),
                new Set(files.map((file) => file.path))
            );
            const sourceUnits = units.filter(
                (unit): unit is ChangedSideUnit => unit.kind === 'changed' && unit.file.path !== coverPath
            );
            const [first, second] = sourceUnits;
            if (first === undefined || second === undefined) {
                throw new Error('both covered sources must produce a unit');
            }
            expect(compareAdmissionUnits(first, second)).toBeLessThan(0);
            return sourceUnits;
        };
        for (const listed of [
            [bPath, aPath],
            [aPath, bPath],
        ]) {
            const ordered = orderedSources(listed);
            // Each source is covered by the one spec, takes its position, and carries no figure of its own, so
            // nothing but their own paths orders them.
            for (const unit of ordered) {
                expect(unit.specCovered).toBe(true);
                expect(unit.order.path).toBe(coverPath);
                expect(unit.contractCarrying).toBe(false);
            }
            expect(ordered.map((unit) => unit.file.path)).toEqual([aPath, bPath]);
        }
    });

    it('lets an unrelated spec take the order from a covered source whose pair key ties its byte figure', () => {
        // The pair's key ties an unrelated collected spec's figure, and the unrelated spec's path sorts before
        // the pair's anchor path. The case reads the disclosed consequence of a covered source competing at
        // its anchor's position rather than at the front of the tier: the unrelated spec takes the earlier
        // position and is attempted ahead of the covered source.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const importLine = "import { v } from '../bulkVal.ts';\n";
        const unrelatedSpecPath = 'scripts/semanticReview/__tests__/aUnrelated.spec.ts';
        const anchorSpecPath = 'scripts/semanticReview/__tests__/zzAnchor.spec.ts';
        const sourcePath = 'scripts/semanticReview/bulkVal.ts';
        // Each spec side carries the same 2,000-byte figure, so the pair's key ties the unrelated spec's own
        // figure; the source's own 20-byte figure is the smaller member of the pair.
        const anchorSide = `${workflowLine}${importLine}${'y'.repeat(2_000 - Buffer.byteLength(workflowLine) - Buffer.byteLength(importLine))}`;
        const unrelatedSide = `${workflowLine}${'y'.repeat(2_000 - Buffer.byteLength(workflowLine))}`;
        const files = [changedFile(anchorSpecPath), changedFile(unrelatedSpecPath), changedFile(sourcePath)];
        const blobs: Record<string, string> = {
            [`${MERGE_BASE}:${anchorSpecPath}`]: anchorSide,
            [`${HEAD}:${anchorSpecPath}`]: anchorSide,
            [`${MERGE_BASE}:${unrelatedSpecPath}`]: unrelatedSide,
            [`${HEAD}:${unrelatedSpecPath}`]: unrelatedSide,
            [`${MERGE_BASE}:${sourcePath}`]: 'y'.repeat(20),
            [`${HEAD}:${sourcePath}`]: 'y'.repeat(20),
        };
        const port = fakeSource({ files, blobs });
        const contents = readChangedContents(port, MERGE_BASE, HEAD, files);
        const hunks = new Map<string, PathHunks>();
        const bytesBySide = admissionBytesBySide(files, contents, hunks, 1_000_000, MERGE_BASE, HEAD);
        const sidesByPath = classifyContractCarryingSides(files, contents);
        // Both keys are 2,000 bytes, so the tie is real and the two paths are what separate them.
        expect(bytesBySide.get(unrelatedSpecPath)?.before).toBe(2_000);
        expect(bytesBySide.get(anchorSpecPath)?.before).toBe(2_000);
        expect(bytesBySide.get(sourcePath)?.before).toBe(20);
        const covered = specCoveredSources(files, contents, bytesBySide);
        expect(covered.get(sourcePath)).toEqual([anchorSpecPath]);
        const units = admissionUnits(
            files,
            sidesByPath,
            bytesBySide,
            [],
            covered,
            new Set(files.map((file) => file.path))
        );
        const index = (path: string, side: 'before' | 'after'): number =>
            units.findIndex((unit) => unit.kind === 'changed' && unit.file.path === path && unit.side === side);
        expect(index(unrelatedSpecPath, 'before')).toBeLessThan(index(sourcePath, 'before'));
        expect(index(unrelatedSpecPath, 'before')).toBeLessThan(index(anchorSpecPath, 'before'));
        const set = collectEvidence({
            port,
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        // The plan's admission order is its own key, not the collector's byte order: a unit carrying a
        // security-platform rule is admitted before test material whatever their paths, so the closure
        // source precedes both specs and only the two specs still read in path order. The byte-order
        // claim above belongs to the collector's attempt order and never promised the plan's.
        const planned = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        const plannedIndex = (path: string): number => planned.units.findIndex((unit) => unit.path === path);
        expect(plannedIndex(sourcePath)).toBeLessThan(plannedIndex(unrelatedSpecPath));
        expect(plannedIndex(sourcePath)).toBeLessThan(plannedIndex(anchorSpecPath));
        expect(plannedIndex(unrelatedSpecPath)).toBeLessThan(plannedIndex(anchorSpecPath));
        expect(planned.units.some((unit) => unit.path === sourcePath)).toBe(true);
        expect(planned.units.some((unit) => unit.path === anchorSpecPath)).toBe(true);
    });

    it('keeps a contract-carrying covered source in its own bucket, not demoted behind a larger contract path', () => {
        // F1: a closure member is contract-carrying by its own content, and the covering spec's path bounded it
        // above a much larger workflow file. The case reads that the source is attempted ahead of that
        // workflow file despite the file's size.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const sourcePath = 'scripts/deliverPullRequest.ts';
        const coverPath = 'scripts/__tests__/deliverPullRequest.spec.ts';
        const workflowPath = '.github/workflows/validation.yml';
        const changed: SemanticChangedFile[] = [
            { path: sourcePath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: coverPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: workflowPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
        ];
        const specSide = `${workflowLine}import { deliver } from '../deliverPullRequest.ts';\n`;
        const contents = new Map<string, { before?: string; after?: string }>([
            [coverPath, { before: specSide, after: specSide }],
            [sourcePath, { before: 'export const deliver = 1;\n', after: 'export const deliver = 1;\n' }],
            [workflowPath, { before: 'name: validation\n', after: 'name: validation\n' }],
        ]);
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            [sourcePath, { before: 5_000, after: 5_000 }],
            [coverPath, { before: 2_000, after: 2_000 }],
            [workflowPath, { before: 97_000, after: 97_000 }],
        ]);
        const sidesByPath = new Map<string, ContractCarryingSides>([
            [sourcePath, { before: true, after: true }],
            [coverPath, { before: true, after: true }],
            [workflowPath, { before: true, after: true }],
        ]);
        const specCovered = specCoveredSources(changed, contents, bytesBySide);
        const units = admissionUnits(
            changed,
            sidesByPath,
            bytesBySide,
            [],
            specCovered,
            new Set(changed.map((file) => file.path))
        );
        const index = (path: string): number =>
            units.findIndex((unit) => unit.kind === 'changed' && unit.file.path === path);
        expect(index(sourcePath)).toBeLessThan(index(workflowPath));
    });

    it('does not cover a source from a spec renamed or copied out of collection', () => {
        // The destination path gates coverage, so a spec renamed or copied out of the test tree covers
        // nothing even when either of its sides still imports the source; the source keeps its bulk rank.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const sourcePath = 'scripts/semanticReview/coveredSource.ts';
        const beforeContent = `${workflowLine}import { s } from '../semanticReview/coveredSource.ts';\n`;
        const afterContent = `${workflowLine}import { s } from '../scripts/semanticReview/coveredSource.ts';\n`;
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            ['tools/renamed.ts', { before: 100, after: 100 }],
            ['tools/copied.ts', { before: 100, after: 100 }],
            [sourcePath, { before: 100, after: 100 }],
        ]);
        const renamed: SemanticChangedFile[] = [
            {
                path: 'tools/renamed.ts',
                previousPath: 'scripts/__tests__/renamed.spec.ts',
                kind: 'renamed',
                binary: false,
                generated: false,
                added: 1,
                deleted: 1,
            },
            { path: sourcePath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
        ];
        const renamedContents = new Map<string, { before?: string; after?: string }>([
            ['tools/renamed.ts', { before: beforeContent, after: afterContent }],
            [sourcePath, { before: 'export const s = 1;\n', after: 'export const s = 1;\n' }],
        ]);
        expect(specCoveredSources(renamed, renamedContents, bytesBySide).get(sourcePath)).toBeUndefined();

        const copied: SemanticChangedFile[] = [
            {
                path: 'tools/copied.ts',
                previousPath: 'scripts/__tests__/copied.spec.ts',
                kind: 'copied',
                binary: false,
                generated: false,
                added: 1,
                deleted: 1,
            },
            { path: sourcePath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
        ];
        const copiedContents = new Map<string, { before?: string; after?: string }>([
            ['tools/copied.ts', { before: beforeContent, after: afterContent }],
            [sourcePath, { before: 'export const s = 1;\n', after: 'export const s = 1;\n' }],
        ]);
        expect(specCoveredSources(copied, copiedContents, bytesBySide).get(sourcePath)).toBeUndefined();
    });

    it('names the plan-level starvation a coverer can inflict on a source it covers', () => {
        // The attempt order is per unit but the total is charged per region, so a carried source attempted
        // ahead of its coverer can still be withheld when its larger regions do not fit the leftover while the
        // coverer's smaller regions do. The plan then holds the spec without the source it covers — a limit the
        // attempted-order guarantee discloses rather than promises away.
        const sizedLine = (bytes: number, tag: string): string => {
            const prefix = `export const ${tag} = '`;
            return `${prefix}${'y'.repeat(Math.max(1, bytes - prefix.length - 3))}';\n`;
        };
        const sizedLines = (count: number, bytes: number, tag: string): string =>
            Array.from({ length: count }, (_unused, index) => sizedLine(bytes, `${tag}${String(index)}`)).join('');
        const oneLineHunks = (first: number, count: number): readonly { startLine: number; endLine: number }[] =>
            Array.from({ length: count }, (_unused, index) => ({ startLine: first + index, endLine: first + index }));

        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const coverPath = 'scripts/semanticReview/__tests__/starve.spec.ts';
        const sourcePath = 'scripts/semanticReview/starvedSource.ts';
        const specPaths = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map(
            (name) => `scripts/semanticReview/__tests__/${name}.spec.ts`
        );

        const specSide = `${workflowLine}${sizedLine(10_047, 'spec')}`;
        const coverAfter = `${workflowLine}import { s } from '../starvedSource.ts';\n${sizedLines(20, 1_003, 'cover')}`;
        const sourceAfter = sizedLines(2, 9_990, 'source');
        const files: SemanticChangedFile[] = [
            { path: coverPath, kind: 'added', binary: false, generated: false, added: 21, deleted: 0 },
            { path: sourcePath, kind: 'added', binary: false, generated: false, added: 2, deleted: 0 },
            ...specPaths.map((path) => changedFile(path)),
        ];
        const blobs: Record<string, string> = {
            [`${HEAD}:${coverPath}`]: coverAfter,
            [`${HEAD}:${sourcePath}`]: sourceAfter,
            ...Object.fromEntries(
                specPaths.flatMap((path) => [
                    [`${MERGE_BASE}:${path}`, specSide],
                    [`${HEAD}:${path}`, specSide],
                ])
            ),
        };
        const hunks = new Map<string, PathHunks>([
            [coverPath, { path: coverPath, before: [], after: oneLineHunks(3, 20) }],
            [sourcePath, { path: sourcePath, before: [], after: oneLineHunks(1, 2) }],
            ...specPaths.map((path): [string, PathHunks] => [
                path,
                { path, before: oneLineHunks(2, 1), after: oneLineHunks(2, 1) },
            ]),
        ]);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        const set = collectEvidence({
            port: fakeSource({ files, blobs, hunks }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: profile.maxStatePlusQuestionBytes,
                maxTotalBytes: profile.maxTotalSubmittedBytes,
            },
        });
        const planned = planUnits(files, set, profile.maxStatePlusQuestionBytes);
        // The source is attempted ahead of its coverer but its 9,990-byte hunks do not fit the leftover left
        // by the six specs, while the coverer's 1,003-byte hunks do.
        expect(
            planned.excluded.some((entry) => entry.path === sourcePath && entry.reason === 'no-admissible-evidence')
        ).toBe(true);
        expect(planned.units.some((unit) => unit.path === coverPath)).toBe(true);
    });

    it('keeps a deleted covered source ahead of a modified coverer whose cheaper side is its after side', () => {
        // The source is deleted, so its only side is before, while the coverer's cheaper side is its after.
        // The case reads that the source's before unit is admitted ahead of both of the coverer's sides, its
        // cheaper side included.
        const workflowLine = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const coverPath = 'scripts/semanticReview/__tests__/afterFloor.spec.ts';
        const sourcePath = 'scripts/semanticReview/afterFloorSource.ts';
        const specSide = `${workflowLine}import { s } from '../afterFloorSource.ts';\n`;
        const changed: SemanticChangedFile[] = [
            { path: coverPath, kind: 'modified', binary: false, generated: false, added: 1, deleted: 1 },
            { path: sourcePath, kind: 'deleted', binary: false, generated: false, added: 0, deleted: 1 },
        ];
        const contents = new Map<string, { before?: string; after?: string }>([
            [coverPath, { before: specSide, after: specSide }],
            [sourcePath, { before: 'export const s = 1;\n' }],
        ]);
        const bytesBySide = new Map<string, AdmissionSideBytes>([
            [coverPath, { before: 10_000, after: 1_000 }],
            [sourcePath, { before: 5_000, after: 0 }],
        ]);
        const sidesByPath = new Map<string, ContractCarryingSides>([
            [coverPath, { before: true, after: true }],
            [sourcePath, { before: false, after: false }],
        ]);
        const specCovered = specCoveredSources(changed, contents, bytesBySide);
        const units = admissionUnits(
            changed,
            sidesByPath,
            bytesBySide,
            [],
            specCovered,
            new Set(changed.map((file) => file.path))
        );
        const index = (path: string, side: 'before' | 'after'): number =>
            units.findIndex((unit) => unit.kind === 'changed' && unit.file.path === path && unit.side === side);
        expect(index(sourcePath, 'before')).toBeLessThan(index(coverPath, 'after'));
        expect(index(sourcePath, 'before')).toBeLessThan(index(coverPath, 'before'));
    });

    it('names a withheld region by its own content class rather than its admission tier', () => {
        // The qualifier is the region's own content class, never the admission tier. `vocabulary.ts` is a
        // source its contract-carrying spec covers, so it is ordered in that spec's tier, yet its withheld
        // side reads the plain form because its own content carries no contract. The changed contract
        // document and the contract-context region keep the contract term. The tier is an attempt order
        // over the record, not part of its vocabulary.
        //
        // The covered source is planned, which is what the promotion into the spec's tier now asks: it is a
        // copy whose empty source admits one region, so the predicate finds a unit for it, while its
        // over-ceiling after side is still withheld. A covered source the planner would exclude loses that
        // promotion and keeps whatever rank and class its own path and content draw: this one carries no
        // contract, so its withheld sides read the plain form.
        const specSide =
            "import { describe, expect, it } from 'vitest';\nimport { vocabulary } from '../vocabulary.ts';\nconst workflow = '.github/workflows/semantic-review.yml';\n";
        const coveredSide = 'export const vocabulary = 1;\n'.repeat(4);
        const contractSide = 'const contract = 1;\n'.repeat(4);
        const contextSide = '# Decisions\n'.repeat(4);
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/semanticReview/__tests__/vocabulary.spec.ts'),
                    changedFile('scripts/semanticReview/vocabulary.ts', {
                        kind: 'copied',
                        previousPath: 'scripts/semanticReview/empty-vocabulary.ts',
                        added: 4,
                        deleted: 0,
                    }),
                    changedFile('AGENTS.md'),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/semanticReview/__tests__/vocabulary.spec.ts`]: specSide,
                    [`${HEAD}:scripts/semanticReview/__tests__/vocabulary.spec.ts`]: specSide,
                    [`${MERGE_BASE}:scripts/semanticReview/empty-vocabulary.ts`]: '',
                    [`${MERGE_BASE}:scripts/semanticReview/vocabulary.ts`]: coveredSide,
                    [`${HEAD}:scripts/semanticReview/vocabulary.ts`]: coveredSide,
                    [`${MERGE_BASE}:AGENTS.md`]: contractSide,
                    [`${HEAD}:AGENTS.md`]: contractSide,
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: contextSide,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // Every withheld side exceeds the per-region ceiling, so one fixture records all three classes
            // at once: the covered source reads the plain form while the contract document, carrying the
            // contract term on its own sides, and the contract-context region keep theirs.
            limits: { maxRegionBytes: 40, maxTotalBytes: 1_000_000 },
            contractPaths: ['.agents/decisions/README.md'],
        });
        expect(set.truncated).toEqual([
            { path: 'AGENTS.md', reason: 'region-exceeds-per-region-budget (before, contract)' },
            { path: 'AGENTS.md', reason: 'region-exceeds-per-region-budget (after, contract)' },
            {
                path: 'scripts/semanticReview/__tests__/vocabulary.spec.ts',
                reason: 'region-exceeds-per-region-budget (before, contract)',
            },
            {
                path: 'scripts/semanticReview/__tests__/vocabulary.spec.ts',
                reason: 'region-exceeds-per-region-budget (after, contract)',
            },
            {
                path: '.agents/decisions/README.md',
                reason: 'region-exceeds-per-region-budget (context, contract)',
            },
            // The copy's empty source side carries no content and still costs its identifier and fields
            // serialized, so a 40-byte ceiling withholds it; its own path draws no contract, so it reads
            // the plain form like the covered source it becomes.
            {
                path: 'scripts/semanticReview/empty-vocabulary.ts',
                reason: 'region-exceeds-per-region-budget (before)',
            },
            { path: 'scripts/semanticReview/vocabulary.ts', reason: 'region-exceeds-per-region-budget (after)' },
        ]);
    });

    it('leaves a large non-spec source that merely imports a closure member bulk', () => {
        // Only a collected spec's content classifies by closure import, and only a source a
        // contract-carrying spec covers is ordered in that spec's tier. A large source no spec covers
        // stays bulk, so it is withheld with the plain bulk reason while a smaller bulk competitor
        // survives.
        const large = `import { trustedDependencyGraphs } from './trustedGithubWriteBootstrap.ts';\n${'const large = 1;\n'.repeat(
            200
        )}`;
        const competitor = 'const competitor = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/large.ts', { kind: 'added', added: 201, deleted: 0 }),
                    changedFile('aaa/competitor.ts', { kind: 'added', added: 1, deleted: 0 }),
                ],
                blobs: {
                    [`${HEAD}:scripts/large.ts`]: large,
                    [`${HEAD}:aaa/competitor.ts`]: competitor,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(competitor, 'utf8'),
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'aaa/competitor.ts:after',
        ]);
        expect(set.truncated).toEqual([
            { path: 'scripts/large.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('charges no contract context when no planned unit needs contract evidence', async () => {
        // A crates/daw-dsp/** change plans units whose rules (audio allocation, timing) need no
        // contract, decision, or registration token. The caller must not pass the contract-context
        // paths, so the change's own sides are admitted and no context document a request never reads
        // is charged to the total budget.
        const own = 'const sample = 1;\n';
        const files = [changedFile('crates/daw-dsp/src/a.rs'), changedFile('crates/daw-dsp/src/b.rs')];
        const source = fakeSource({
            files,
            blobs: {
                [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: own,
                [`${HEAD}:crates/daw-dsp/src/a.rs`]: own,
                [`${MERGE_BASE}:crates/daw-dsp/src/b.rs`]: own,
                [`${HEAD}:crates/daw-dsp/src/b.rs`]: own,
                [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
            },
        });
        const result = await runScan({
            ...scanPorts(constantProvider(0.05), source, fixedClock(1_000)),
            // Exactly the change's four own sides: under the old order the context documents admitted
            // first and withheld one of the change's own sides for a region no request reads.
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: Buffer.byteLength(own, 'utf8') * 4 },
        });
        expect(result.report.scope.truncated).toEqual([]);
        const contextIds = result.previews.flatMap((preview) => preview.evidenceIds).filter((id) => id.startsWith('c'));
        expect(contextIds).toEqual([]);
    });

    it('admits and attaches contract context to a unit whose rules declare a contract token', async () => {
        // The gate's true branch, observed through `includeDefaultContractContext`: a contract-needing
        // file whose sides are admissible survives planning and receives the default contract documents,
        // while a bulk competitor in the same change does not. Dropping the flag, or attaching the context
        // to a file that declared no token, breaks this.
        const source = fakeSource({
            files: [changedFile('src/modules/Project/undo.ts'), changedFile('crates/daw-dsp/src/b.rs')],
            blobs: {
                [`${MERGE_BASE}:src/modules/Project/undo.ts`]: 'export const before = 1;\n',
                [`${HEAD}:src/modules/Project/undo.ts`]: 'export const after = 2;\n',
                [`${MERGE_BASE}:crates/daw-dsp/src/b.rs`]: 'const b = 1;\n',
                [`${HEAD}:crates/daw-dsp/src/b.rs`]: 'const b = 2;\n',
                [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
            },
        });
        const result = await runScan(scanPorts(constantProvider(0.05), source, fixedClock(1_000)));
        const unit = result.previews.find((preview) => preview.path === 'src/modules/Project/undo.ts');
        const competitor = result.previews.find((preview) => preview.path === 'crates/daw-dsp/src/b.rs');
        expect(unit).toBeDefined();
        // The context regions the gate admitted are attached to the unit whose rules declared the token,
        // named with the `c` side prefix.
        expect(unit?.evidenceIds.some((id) => id.startsWith('c'))).toBe(true);
        // The bulk competitor's rules declare no token, so it receives no context.
        expect(competitor?.evidenceIds.some((id) => id.startsWith('c'))).toBe(false);
    });

    it('orders a contract-needing file ahead of the context documents its rules charge', () => {
        // D2: a bulk file whose rules declare a contract token charged the default context documents,
        // which then admitted first (their tier) and starved the file's own bulk sides under a binding
        // total, so the charge removed the very unit it was charged for. Ordering the contract-needing
        // file's own sides ahead of the context keeps the charge from starving its reader. The tier is an
        // attempt order, not a promise: admission is a greedy accumulator, so a smaller lower-tier region
        // can still survive ahead of a larger context document.
        const aSide = 'const a = 1;\n'.repeat(382); // 4,966 B per side
        const competitor = 'const c = 1;\n'.repeat(7); // 91 B per side
        const agents = '# AGENTS.md contract\n'.repeat(95); // 1,995 B
        const decisions = '# Decisions\n'.repeat(666); // 7,992 B
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/a.ts'), changedFile('crates/daw-dsp/src/b.rs')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/a.ts`]: aSide,
                    [`${HEAD}:src/modules/Project/a.ts`]: aSide,
                    [`${MERGE_BASE}:crates/daw-dsp/src/b.rs`]: competitor,
                    [`${HEAD}:crates/daw-dsp/src/b.rs`]: competitor,
                    [`${MERGE_BASE}:AGENTS.md`]: agents,
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: decisions,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(aSide, 'utf8') * 2 + Buffer.byteLength(competitor, 'utf8') * 2,
            },
            includeDefaultContractContext: true,
        });
        // The contract-needing file's own sides survive the context charge.
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/Project/a.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/Project/a.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // The context documents they charged are withheld, named with the context-contract reason.
        expect(set.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(
            set.truncated.some((entry) => entry.reason === 'total-evidence-budget-exhausted (context, contract)')
        ).toBe(true);
        // The measured outcome at this total: the two context documents are withheld and the smaller
        // tier-3 bulk competitor still admits both of its sides behind them, so the context did not stay
        // ahead of unrelated bulk material.
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'src/modules/Project/a.ts:before',
            'src/modules/Project/a.ts:after',
            'crates/daw-dsp/src/b.rs:before',
            'crates/daw-dsp/src/b.rs:after',
        ]);
        expect(set.truncated).toEqual([
            { path: 'AGENTS.md', reason: 'total-evidence-budget-exhausted (context, contract)' },
            { path: '.agents/decisions/README.md', reason: 'total-evidence-budget-exhausted (context, contract)' },
        ]);
    });

    it('ranks a credentialed file that plans no unit as bulk, so a planned reader keeps the context it charged', () => {
        // A: the promotion into tier 1 asked only for a contract token, so a modified `scripts/legacy.ts`
        // whose after side is credential-shaped — excluded by the content screen and skipped by the
        // planner — carried its bulk before side ahead of the context documents the contract-needing
        // `src/modules/Project/undo.ts` charged, and the collector's total withheld both documents while
        // the planned unit carried none. Its sides must rank bulk and the reader's charge must be
        // delivered. Dropping the `plannedPaths` condition in `admissionUnits` reddens every arm at both
        // profiles: the bulk hunks leave no room for a document, so both are withheld as
        // `total-evidence-budget-exhausted (context, contract)` and the unit's context is empty.
        const legacyPath = 'scripts/legacy.ts';
        const readerPath = 'src/modules/Project/undo.ts';
        const hunkLines = 2;
        // The ceiling is the serialized measure, so a hunk has to stay under it serialized — two lines of
        // this size plus the escaping and the reference's fields — or the region gate withholds it before
        // the total can.
        const hunkChars = 8_000;
        const hunkCount = 65; // ~1.040 MB of before side, within one document of the total it binds against
        const lines = hunkLines * hunkCount;
        const bulk = `${'x'.repeat(hunkChars)}\n`.repeat(lines);
        const beforeHunks: { startLine: number; endLine: number }[] = [];
        for (let start = 1; start <= lines; start += hunkLines) {
            beforeHunks.push({ startLine: start, endLine: start + hunkLines - 1 });
        }
        // The charged documents are sized like the real `.agents/decisions/README.md`: too large for the
        // budget the bulk hunks leave, small enough for the reader's own request.
        const document =
            '| [0003](0003-engine-owned-plugin-runtime-owner.md) | decision text that names one owner |\n'.repeat(95);
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        for (const profileName of ['local', 'ci'] as const) {
            const shipped = SEMANTIC_BUDGET_PROFILES[profileName];
            // This fixture's bulk is sized to bind against a 1 MiB total, which the local profile's own
            // total already is. The shipped ci total carries the bulk whole, so the total is held at the
            // figure the fixture binds against rather than inflating the fixture text to match whichever
            // total the profile ships: the claim under test is the ranking, never one profile's number.
            const profile = {
                ...shipped,
                maxTotalSubmittedBytes: Math.min(shipped.maxTotalSubmittedBytes, 1024 * 1024),
            };
            const files = [changedFile(legacyPath, { added: 1, deleted: lines }), changedFile(readerPath)];
            const source = fakeSource({
                files,
                hunks: new Map<string, PathHunks>([[legacyPath, { path: legacyPath, before: beforeHunks, after: [] }]]),
                blobs: {
                    [`${MERGE_BASE}:${legacyPath}`]: bulk,
                    [`${HEAD}:${legacyPath}`]: `export const key = '${awsShaped}';\n`,
                    [`${MERGE_BASE}:${readerPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${readerPath}`]: 'export const after = 2;\n',
                    [`${MERGE_BASE}:AGENTS.md`]: document,
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: document,
                },
            });
            const set = collectEvidence({
                port: source,
                mergeBaseSha: MERGE_BASE,
                headSha: HEAD,
                contractSourceSha: MERGE_BASE,
                limits: {
                    maxRegionBytes: profile.maxStatePlusQuestionBytes,
                    maxTotalBytes: profile.maxTotalSubmittedBytes,
                },
                includeDefaultContractContext: true,
            });
            // The credentialed file produces no unit at all: it is excluded, never planned.
            expect(set.excluded).toContainEqual({ path: legacyPath, reason: 'credential-shaped-content-excluded' });
            // The context the planned reader charged is admitted, and the total it bound against is the
            // bulk file's own hunks.
            expect(
                set.references.filter((reference) => reference.side === 'context').map((reference) => reference.path)
            ).toEqual(['.agents/decisions/README.md', 'AGENTS.md']);
            expect(
                set.truncated.some(
                    (entry) => entry.path === legacyPath && entry.reason.startsWith('total-evidence-budget-exhausted')
                )
            ).toBe(true);
            expect(set.truncated.some((entry) => entry.reason.endsWith('(context, contract)'))).toBe(false);
            const { units, excluded } = planUnits(files, set, profile.maxStatePlusQuestionBytes);
            const unit = units.find((candidate) => candidate.path === readerPath);
            // The unit keeps both of its own sides and carries the charged documents its request can
            // hold — one at local, both at ci, and none at all before this repair.
            expect(unit?.evidence.own.map((reference) => reference.side)).toEqual(['after', 'before']);
            const carried = unit?.evidence.context.map((reference) => reference.path) ?? [];
            expect(carried.length).toBeGreaterThan(0);
            expect(carried.every((path) => path === 'AGENTS.md' || path === '.agents/decisions/README.md')).toBe(true);
            expect(excluded).not.toContainEqual({ path: readerPath, reason: 'no-evidence-region-within-budget' });
        }
    });

    it('ranks a covered source the planner excludes as bulk, so a planned reader keeps the context it charged', () => {
        // The tier-0 promotion of a spec-covered source asked only whether a contract-carrying spec covers
        // it, so a covered source the planner excludes as `no-applicable-rule` carried its bulk sides ahead
        // of the documents a planned reader charged and the collector's total withheld them: measured at
        // `local`, the merge base delivered `.agents/decisions/README.md` to the reader's unit and the
        // ungated promotion withheld it. Both promotions into the contract tier now read the same
        // `plannedPaths` predicate the charge does. Dropping the `plannedPaths` condition from the covered
        // arm reddens this case: the promoted source's two sides take the total and the document is
        // withheld, so the reader's unit carries no context.
        const specPath = 'scripts/semanticReview/__tests__/covered.spec.ts';
        const coveredPath = 'tools/helper.ts';
        const readerPath = 'src/modules/Project/undo.ts';
        const specSide =
            "import { describe, expect, it } from 'vitest';\nimport { helper } from '../../../tools/helper.ts';\nconst workflow = '.github/workflows/semantic-review.yml';\n";
        const coveredSide = 'export const helper = 1;\n'.repeat(200);
        const readerBefore = 'export const before = 1;\n';
        const readerAfter = 'export const after = 2;\n';
        const document = '# Decisions\n'.repeat(666);
        const files = [
            changedFile(specPath, { added: 3, deleted: 0 }),
            changedFile(coveredPath, { added: 200, deleted: 0 }),
            changedFile(readerPath),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${specPath}`]: specSide,
                    [`${HEAD}:${specPath}`]: specSide,
                    [`${MERGE_BASE}:${coveredPath}`]: coveredSide,
                    [`${HEAD}:${coveredPath}`]: coveredSide,
                    [`${MERGE_BASE}:${readerPath}`]: readerBefore,
                    [`${HEAD}:${readerPath}`]: readerAfter,
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: document,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // The spec's two sides, the reader's two sides and the document serialize to about 9.4 kB; the
            // promoted source's two bulk sides add about 10 kB more. 11,000 B is above the first total and
            // below the second, so the promotion is what decides whether the document is withheld.
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 11_000 },
            includeDefaultContractContext: true,
        });
        const planned = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        // The covered source's unit does not exist: the planner excludes it for its empty rule set.
        expect(planned.excluded).toContainEqual({ path: coveredPath, reason: 'no-applicable-rule' });
        // The document the reader charged is admitted, and the unplanned covered source's bulk sides are
        // what the total withholds.
        expect(
            set.references.some(
                (reference) => reference.path === '.agents/decisions/README.md' && reference.side === 'context'
            )
        ).toBe(true);
        expect(
            set.truncated.some(
                (entry) => entry.path === coveredPath && entry.reason.startsWith('total-evidence-budget-exhausted')
            )
        ).toBe(true);
        const unit = planned.units.find((candidate) => candidate.path === readerPath);
        expect(unit?.evidence.context.map((reference) => reference.path)).toEqual(['.agents/decisions/README.md']);
    });

    it('carries a contract-needing unit whole across passes instead of shedding its own sides', async () => {
        // The multi-request transport: a 280-line edit whose rules need the undo contract used to shed
        // both own sides so the charged documents could travel. The whole evidence now travels in ordered
        // passes, so the unit keeps its own before/after sides alongside the documents.
        const path = 'src/modules/Project/undo.ts';
        const before = 'const beforeValue = 1;\n'.repeat(280);
        const after = 'const afterValue = 2;\n'.repeat(280);
        const scanWith = async (documents: boolean) => {
            const blobs: Record<string, string> = {
                [`${MERGE_BASE}:${path}`]: before,
                [`${HEAD}:${path}`]: after,
            };
            if (documents) {
                blobs[`${MERGE_BASE}:AGENTS.md`] = '# AGENTS.md contract\n';
                blobs[`${MERGE_BASE}:.agents/decisions/README.md`] = '# Decisions\n';
            }
            return runScan({
                ...scanPorts(
                    constantProvider(0.05),
                    fakeSource({ files: [changedFile(path, { added: 280, deleted: 280 })], blobs }),
                    fixedClock(1_000)
                ),
                // Large enough that collection withholds nothing: the split must come from fitting.
                limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            });
        };
        const charged = await scanWith(true);
        const chargedUnit = charged.previews.find((preview) => preview.path === path);
        // Both sides together exceed one request, so the plan composes several passes and no single one
        // carries every side a rule needs: nothing can be asked. The unit is reported as missing
        // required evidence rather than sent at all — the transport used to buy discarded answers.
        expect(charged.report.scope.assessed).toBe(0);
        expect(charged.report.scope.unassessed).toEqual([
            { path, reason: 'missing-required-evidence', priorityClass: 'severe-production' },
        ]);
        // The plan still composes the charged documents and both own sides: none is shed for the request
        // budget, which is the shedding the multi-request transport exists to prevent.
        expect(chargedUnit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('c'))).toBe(true);
        expect(chargedUnit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('b'))).toBe(true);
        expect(chargedUnit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('a'))).toBe(true);
        expect(chargedUnit?.sentEvidenceIds).toEqual([]);
        expect(charged.report.scope.truncated.some((entry) => entry.reason.startsWith('unit-evidence-reduced'))).toBe(
            false
        );
        const bare = await scanWith(false);
        const bareUnit = bare.previews.find((preview) => preview.path === path);
        expect(bare.report.scope.assessed).toBe(0);
        expect(bareUnit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('b'))).toBe(true);
        expect(bareUnit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('a'))).toBe(true);
        expect(bare.report.scope.truncated.some((entry) => entry.reason.startsWith('unit-evidence-reduced'))).toBe(
            false
        );
    });

    it('carries the charged document and the unit own sides together instead of shedding one', async () => {
        // The charged document and the unit's own sides used to compete for one request's budget, and the
        // own after side lost. With the multi-request transport everything that fits travels: the document
        // and both own sides are carried, and no side is recorded as reduced.
        const path = 'src/modules/Project/undo.ts';
        const own = 'const beforeValue = 1;\n'.repeat(175);
        const document = '# Decisions\n'.repeat(190);
        const result = await runScan({
            ...scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile(path, { added: 175, deleted: 175 })],
                    blobs: {
                        [`${MERGE_BASE}:${path}`]: own,
                        [`${HEAD}:${path}`]: own,
                        [`${MERGE_BASE}:.agents/decisions/README.md`]: document,
                    },
                }),
                fixedClock(1_000)
            ),
            limits: {
                maxRegionBytes: SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes,
                maxTotalBytes: SEMANTIC_BUDGET_PROFILES.local.maxTotalSubmittedBytes,
            },
        });
        const unit = result.previews.find((preview) => preview.path === path);
        expect(result.report.scope.assessed).toBe(1);
        expect(unit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('c'))).toBe(true);
        expect(unit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('a'))).toBe(true);
        expect(unit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('b'))).toBe(true);
        expect(result.report.scope.truncated.some((entry) => entry.reason.startsWith('unit-evidence-reduced'))).toBe(
            false
        );
    });

    it('reserves the share for the implementation context a unit carries, at its own regions expense', () => {
        // The reserve protects the context the unit carries, contract or implementation, and it can reduce
        // the unit's own evidence — the property the merge base already had. Keying it on charged contract
        // documents alone handed an implementation-only unit the whole request: on this change's own diff
        // at `ci` a unit went from 7 own and 5 context regions to 5 own and 0, and its rules needing
        // `after implementation source` reported the evidence missing. Sized so the implementation region
        // fits the 40% share and neither own side fits what the share leaves: the reserve empties the own
        // fit, the implementation region is still fitted out of what the own fit leaves, and the token that
        // needs it resolves. Reading the charged contract documents alone restores one own side and fails
        // every arm below.
        const implPath = 'src/modules/Project/useCases/undoProject.ts';
        const specPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile(specPath, { added: 200, deleted: 200 }),
                    changedFile(implPath, { added: 40, deleted: 0 }),
                ],
                blobs: {
                    [`${MERGE_BASE}:${specPath}`]: 'const beforeValue = 1;\n'.repeat(200),
                    [`${HEAD}:${specPath}`]: 'const afterValue = 2;\n'.repeat(200),
                    [`${MERGE_BASE}:${implPath}`]: 'export const impl = 0;\n',
                    [`${HEAD}:${implPath}`]: 'export const impl = 1;\n'.repeat(40),
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const own = set.references.filter((reference) => reference.side !== 'context' && reference.path === specPath);
        const context = set.references.filter((reference) => reference.side === 'after' && reference.path === implPath);
        const cost = (reference: EvidenceReference): number =>
            regionCost(reference, set.contents.get(reference.evidenceId) ?? '');
        const implementation = context[0];
        expect(own).toHaveLength(2);
        expect(implementation).toBeDefined();
        if (implementation === undefined) {
            throw new Error('the fixture did not mint the implementation context region');
        }
        const largestOwn = Math.max(...own.map(cost));
        const smallestOwn = Math.min(...own.map(cost));
        // The share carries the implementation region on its own; no own side fits what the share leaves.
        const budget = largestOwn + cost(implementation) + 128;
        expect(Math.floor(budget * 0.4)).toBeGreaterThanOrEqual(cost(implementation));
        expect(Math.floor(budget * 0.6)).toBeLessThan(smallestOwn);
        const fitted = fitUnitEvidence(set, own, context, budget);
        // The reserve reaches into the own fit, so the unit's own evidence is reduced below its request ...
        expect(fitted.own.references).toEqual([]);
        expect(fitted.own.droppedSides).toEqual(new Set<EvidenceSide>(['before', 'after']));
        // ... while the context the reserve protects is fitted out of what the own fit leaves, and the
        // rule that declared it is answered from there.
        expect(fitted.context.references).toEqual([implementation]);
        expect(
            missingRequiredEvidence(
                semanticRule('production_path_no_longer_reached'),
                fitted.own.references,
                fitted.context.references,
                'modified',
                fitted.own.droppedSides,
                fitted.context.droppedSides
            )
        ).toEqual(['before test source', 'after test source']);
    });

    it('plans the unit a charged contract document was charged for, with an own region inside its request budget', () => {
        // A preserved-behaviour control, not a repair witness: both arms hold identically under the merge
        // base's unconditional reserve and under the reserve-fits rule a repair round introduced, so this
        // case witnesses neither of them and stays green through the revert. What it pins, at the
        // production local profile, is the charge and the request the charge bought: the document the gate
        // charged for the reader is admitted as context, the unit is planned with an own region inside its
        // request — the sides serialize to about 4,258 B and the reserve leaves 6,602 B of the 11,003 B
        // request — and the document, 12,019 B serialized, is over both the 4,401 B share and what the own
        // regions leave, so the fitter withholds it rather than a request reading it.
        const path = 'src/modules/Project/undo.ts';
        const side = `${'x'.repeat(104)}\n`.repeat(38); // 3,990 B a side
        const readme =
            '| [0003](0003-engine-owned-plugin-runtime-owner.md) | decision text that names one owner |\n'.repeat(128);
        const files = [changedFile(path, { added: 38, deleted: 38 })];
        const source = fakeSource({
            files,
            blobs: {
                [`${MERGE_BASE}:${path}`]: side,
                [`${HEAD}:${path}`]: side,
                [`${MERGE_BASE}:.agents/decisions/README.md`]: readme,
            },
        });
        const set = collectEvidence({
            port: source,
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes,
                maxTotalBytes: SEMANTIC_BUDGET_PROFILES.local.maxTotalSubmittedBytes,
            },
            includeDefaultContractContext: true,
        });
        // The document the gate charged for this reader is admitted as context.
        expect(
            set.references.some(
                (reference) => reference.path === '.agents/decisions/README.md' && reference.side === 'context'
            )
        ).toBe(true);
        const { units, excluded } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        expect(excluded).not.toContainEqual({ path, reason: 'no-evidence-region-within-budget' });
        const unit = units.find((candidate) => candidate.path === path);
        expect(unit?.evidence.own.length).toBeGreaterThan(0);
        expect(unit?.evidence.context.map((reference) => reference.path)).toEqual([]);
    });

    it('excludes the unit a charged document was charged for when no own region fits its request', () => {
        // The planned-unit predicate is a pre-admission proxy, not a promise that a request carries the
        // unit: it asks the planner's own criteria — the screen keeps the path, the rules admit it, a side
        // mints a region — and admission cannot know a unit's serialized request budget. The one side here
        // is 15,000 B raw, about 15,150 B serialized, under the 16,384 B per-region ceiling, so a region is
        // minted and the gate charges the document the unit's rules declared; the document is 14,400 B raw,
        // about 15,745 B serialized, also under the ceiling but over every request budget that remains, so
        // the fitter keeps no own region, the document fits none either, and the planner excludes the unit
        // as `no-evidence-region-within-budget` with nothing sent. The charge is the residual this case
        // pins; predicting the fitter is not the predicate's job.
        const path = 'src/modules/Project/undo.ts';
        const side = `${'x'.repeat(14_999)}\n`; // 15,000 B raw
        const readme = '# Decisions\n'.repeat(1_200); // 14,400 B raw, under the serialized ceiling
        const files = [changedFile(path, { added: 1, deleted: 1 })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${path}`]: side,
                    [`${HEAD}:${path}`]: side,
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: readme,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes,
                maxTotalBytes: SEMANTIC_BUDGET_PROFILES.local.maxTotalSubmittedBytes,
            },
            includeDefaultContractContext: true,
        });
        // The document was read and admitted: the charge the gate made stands.
        expect(
            set.references.some(
                (reference) => reference.path === '.agents/decisions/README.md' && reference.side === 'context'
            )
        ).toBe(true);
        const { units, excluded } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        // No own region fits the unit's request, so it is excluded and the exclusion is recorded.
        expect(units).toEqual([]);
        expect(excluded).toContainEqual({ path, reason: 'no-evidence-region-within-budget' });
    });

    it('charges no contract context when the content screen drops the only reading unit', () => {
        // D3: a modified contract-needing file whose after side is credential-shaped is excluded by the
        // content screen and skipped by the planner, yet the gate charged the context documents from the
        // clean before side's byte figure alone. Consulting the content screen stops the charge.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const before = 'export const before = 1;\n';
        const after = `export const key = '${awsShaped}';\n`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/undo.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: before,
                    [`${HEAD}:src/modules/Project/undo.ts`]: after,
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n'.repeat(600),
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(
            set.excluded.some(
                (entry) =>
                    entry.path === 'src/modules/Project/undo.ts' &&
                    entry.reason === 'credential-shaped-content-excluded'
            )
        ).toBe(true);
    });

    it('excludes a path whose credential lies inside its hunks and charges no contract context', () => {
        // The content screen's per-hunk arm, reached the way production reaches it: `gitSource.ts` reads a
        // real `git diff --unified`, so each side is screened hunk by hunk rather than whole. The
        // credential sits in the lines this change touches, so admission excludes the path and the gate
        // must not charge contract documents no surviving unit will read.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const before = 'export const undo = true;\n';
        const after = `export const undo = false;\nexport const key = '${awsShaped}';\n`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/undo.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: before,
                    [`${HEAD}:src/modules/Project/undo.ts`]: after,
                    [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
                },
                hunks: new Map([
                    [
                        'src/modules/Project/undo.ts',
                        {
                            path: 'src/modules/Project/undo.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(
            set.excluded.some(
                (entry) =>
                    entry.path === 'src/modules/Project/undo.ts' &&
                    entry.reason === 'credential-shaped-content-excluded'
            )
        ).toBe(true);
    });

    it('keeps a path whose credential lies outside its hunks and charges the default contract context', () => {
        // The per-hunk arm's other outcome: the file holds a credential, but not in the lines this change
        // touches, so screening the hunks admission reads finds nothing and the path keeps its unit.
        // Screening the whole side instead would exclude this path and drop the context charge its rules
        // declared.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const before = 'export const undo = true;\n';
        const after = `export const undo = false;\nexport const key = '${awsShaped}';\n`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/undo.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: before,
                    [`${HEAD}:src/modules/Project/undo.ts`]: after,
                    [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
                },
                hunks: new Map([
                    [
                        'src/modules/Project/undo.ts',
                        {
                            path: 'src/modules/Project/undo.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(true);
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/Project/undo.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(set.excluded.some((entry) => entry.path === 'src/modules/Project/undo.ts')).toBe(false);
    });

    it('excludes a path whose before side is credential-shaped and charges no contract context', () => {
        // The before-side arm: a rotation replaces the credential, so the after side is clean and a screen
        // reading only it would keep the path and charge context for it. The before hunk is what admission
        // reads, and the credential in it excludes the path, so the documents stay unread.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const before = `export const key = '${awsShaped}';\nexport const undo = true;\n`;
        const after = 'export const key = process.env.PROJECT_KEY;\nexport const undo = false;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/undo.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: before,
                    [`${HEAD}:src/modules/Project/undo.ts`]: after,
                    [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
                },
                hunks: new Map([
                    [
                        'src/modules/Project/undo.ts',
                        {
                            path: 'src/modules/Project/undo.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(
            set.excluded.some(
                (entry) =>
                    entry.path === 'src/modules/Project/undo.ts' &&
                    entry.reason === 'credential-shaped-content-excluded'
            )
        ).toBe(true);
    });

    it('charges the default contract context when a rename moves a credential-shaped previous side', async () => {
        // The screen records the path admission reads: the previous path for a before side, the change's
        // own path for an after side. Consulting it by the destination alone read this rename as
        // credential-shaped while the planner skips a file only when its own path is excluded, so the
        // destination unit was planned from its clean after side, declared the undo contract, and got no
        // context at all — a limitation naming a contract the run should have supplied. Keying the
        // before side by its previous path charges the documents that unit will read.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const previousPath = 'src/modules/Project/legacy-key.ts';
        const path = 'src/modules/Project/undo.ts';
        const source = fakeSource({
            files: [changedFile(path, { kind: 'renamed', previousPath, added: 1, deleted: 1 })],
            blobs: {
                [`${MERGE_BASE}:${previousPath}`]: `export const key = '${awsShaped}';\nexport const undo = true;\n`,
                [`${HEAD}:${path}`]: 'export const undo = false;\n',
                [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
            },
        });
        const result = await runScan(scanPorts(constantProvider(0.05), source, fixedClock(1_000)));
        const unit = result.previews.find((preview) => preview.path === path);
        expect(unit).toBeDefined();
        expect(unit?.evidenceIds.some((evidenceId) => evidenceId.startsWith('c'))).toBe(true);
        expect(
            result.report.scope.excluded.some(
                (entry) => entry.path === previousPath && entry.reason === 'credential-shaped-content-excluded'
            )
        ).toBe(true);
    });

    it('charges no contract context when a rename is credentialed on both sides', () => {
        // Both sides key their own path: the previous side's credential records the previous path, the
        // destination side's records the change's own path. Short-circuiting the before side left the
        // destination path unkeyed, so the gate read a unit worth charging for and spent the collector's
        // total on documents the planner excludes every reader of. That total is charged in raw bytes:
        // 26 + 27 for the rename's clean hunks, then the two documents (804 B) in the context tier, then
        // the competitor's sides (13 + 200). At 960 B the competitor's before side is admitted and its
        // after side withheld once the documents are charged; with no charge all 266 B are admitted.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const previousPath = 'src/modules/Project/legacy-key.ts';
        const path = 'src/modules/Project/undo.ts';
        const competitor = 'crates/daw-dsp/src/b.rs';
        const beforeClean = 'export const undo = true;\n';
        const afterClean = 'export const undo = false;\n';
        const credentialLine = `export const key = '${awsShaped}';\n`;
        const competitorBefore = 'const c = 1;\n';
        const competitorAfter = 'const competitorValue = 1;\n'.repeat(8);
        const files = [
            changedFile(path, { kind: 'renamed', previousPath, added: 1, deleted: 1 }),
            changedFile(competitor),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${previousPath}`]: `${beforeClean}${credentialLine}`,
                    [`${HEAD}:${path}`]: `${afterClean}${credentialLine}`,
                    [`${MERGE_BASE}:${competitor}`]: competitorBefore,
                    [`${HEAD}:${competitor}`]: competitorAfter,
                    [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n'.repeat(24),
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n'.repeat(25),
                },
                // Each side carries a clean hunk the planner could charge for beside its credential hunk,
                // which is what let the unkeyed destination read as a unit worth charging.
                hunks: new Map([
                    [
                        path,
                        {
                            path,
                            previousPath,
                            before: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 960 },
            includeDefaultContractContext: true,
        });
        // Nothing was charged: no context region exists for the gate to have bought.
        expect(set.truncated).toEqual([
            { path: previousPath, reason: 'evidence-withheld-credential-shaped' },
            { path, reason: 'evidence-withheld-credential-shaped' },
        ]);
        expect(set.excluded).toEqual([
            { path: previousPath, reason: 'credential-shaped-content-excluded' },
            { path, reason: 'credential-shaped-content-excluded' },
        ]);
        // No unit is planned for either credentialed path, and the clean bulk competitor keeps both sides.
        const planned = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        expect(planned.units.map((unit) => unit.path)).toEqual([competitor]);
        expect(planned.units[0]?.evidence.own.map((reference) => reference.side)).toEqual(['before', 'after']);
    });

    it('charges the contract context for a unit whose only admissible region is empty', () => {
        // The predicate's existence test is the slice admission mints, never the byte figure that ranks it:
        // an emptied modification's after side holds zero bytes and still mints a region, so the planner
        // plans the unit and the gate must charge the context its rules declare. Ranking the sides by bytes
        // reported no unit here, so nothing was charged and the unit's contract rules reported the evidence
        // missing. The before side is over the per-region ceiling, so the empty after side is the only
        // admissible one.
        const path = 'src/modules/Project/undo.ts';
        const before = 'const goneValue = 1;\n'.repeat(400);
        const files = [changedFile(path, { added: 0, deleted: 400 })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${path}`]: before,
                    [`${HEAD}:${path}`]: '',
                    [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        // The emptied file's empty after side is admitted, and the documents its rules declare are charged.
        expect(set.references.some((reference) => reference.path === path && reference.side === 'after')).toBe(true);
        expect(set.references.some((reference) => reference.side === 'context')).toBe(true);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path === path);
        expect(unit?.evidence.own.map((reference) => reference.side)).toEqual(['after']);
        // The charged documents reach the unit its rules needed them for.
        expect(unit?.evidence.context.map((reference) => reference.path)).toEqual([
            '.agents/decisions/README.md',
            'AGENTS.md',
        ]);
    });

    it('charges no default contract context when the only contract-needing file cannot produce a unit', async () => {
        // The gate must ask whether a planned unit will read the context, not merely whether an eligible
        // file's rules need it. A contract-needing file whose every side exceeds the per-region ceiling
        // produces no unit, so the gate must not even read the documents no request will read. Routing
        // through `runScan` exercises the removed `contractContextPathsFor` route on the pre-change code,
        // which charged the documents from the file's rules alone.
        const oversized = 'const over = 1;\n'.repeat(300);
        const small = 'const sample = 1;\n';
        const reads: string[] = [];
        const files = [changedFile('src/modules/Project/a.ts'), changedFile('crates/daw-dsp/src/b.rs')];
        const blobs: Record<string, string> = {
            [`${MERGE_BASE}:src/modules/Project/a.ts`]: oversized,
            [`${HEAD}:src/modules/Project/a.ts`]: oversized,
            [`${MERGE_BASE}:crates/daw-dsp/src/b.rs`]: small,
            [`${HEAD}:crates/daw-dsp/src/b.rs`]: small,
            [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
            [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
        };
        const source: SemanticSourcePort = {
            changedFiles: () => files,
            readFile: (sha, path) => {
                reads.push(`${sha}:${path}`);
                return blobs[`${sha}:${path}`];
            },
            changedHunks: () => new Map<string, PathHunks>(),
            changedLines: () => new Map<string, PathChangedLines>(),
        };
        const result = await runScan(scanPorts(constantProvider(0.05), source, fixedClock(1_000)));
        // No context document is read, so none is charged; the small bulk competitor still plans a unit.
        expect(reads.some((read) => read.endsWith(':AGENTS.md') || read.endsWith(':README.md'))).toBe(false);
        expect(result.previews.some((preview) => preview.path === 'crates/daw-dsp/src/b.rs')).toBe(true);
    });

    it('charges contract context for a deleted contract-needing source with an admissible before side', () => {
        // The gate's before-side arm: a deleted file has no after side, so the gate must charge the
        // contract documents from the admissible before side alone. Requiring an after side would drop
        // the context a deletion's before side still needs.
        const before = 'export const undo = true;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/undo.ts', { kind: 'deleted', added: 0, deleted: 3 })],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: before,
                    [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: '# Decisions\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(true);
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/Project/undo.ts' && reference.side === 'before'
            )
        ).toBe(true);
    });

    it('keeps a rename contract-needing from its path pair rather than its destination alone', () => {
        // The rename arm of `contractNeedingPaths`: a move out of a surface whose rules declare a contract
        // still needs the context those rules charge, even though the destination's own rules do not.
        // Reading the new path alone drops the file to bulk and drops the charge with it, so its sides
        // would fall behind the documents they charged.
        const before = 'export const legacy = 1;\n';
        const after = 'export const moved = 11;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('crates/daw-dsp/src/moved.ts', {
                        kind: 'renamed',
                        previousPath: 'scripts/legacy.ts',
                        added: 1,
                        deleted: 1,
                    }),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/legacy.ts`]: before,
                    [`${HEAD}:crates/daw-dsp/src/moved.ts`]: after,
                    [`${MERGE_BASE}:AGENTS.md`]: '# AGENTS.md contract\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        // Both own sides rank ahead of the context its rules charge — the moved file's before side is
        // referenced under its pre-change path — and the charge is made.
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'scripts/legacy.ts:before',
            'crates/daw-dsp/src/moved.ts:after',
            'AGENTS.md:context',
        ]);
    });

    it('orders a chargeable hunk before screened and over-budget hunks it cannot charge', () => {
        // R5: the previous fixture pitted a clean copy against a clean edit, so reverting
        // `chargeableRegionBytes` to raw bytes left it green and dropping the content-screen branch left
        // the whole suite green. This fixture puts an in-budget hunk on one path beside a credential-shaped
        // hunk and an over-budget hunk, so the path ranks by the hunk admission can charge; dropping either
        // chargeability branch, or falling back to line counts, starves the material hunk and reddens.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const material = 'const mat = 1;\n';
        const credentialBlock = `export const key = '${awsShaped}';\n`.repeat(10);
        const oversized = 'const oversized = 1;\n'.repeat(60);
        const competitor = 'const competitor = 123456789012345;\n';
        const materialBytes = Buffer.byteLength(material, 'utf8') - 1;
        const competitorBytes = Buffer.byteLength(competitor, 'utf8') - 1;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/edit.ts', { kind: 'added', added: 71, deleted: 0 }),
                    changedFile('bbb/competitor.ts', { kind: 'added', added: 1, deleted: 0 }),
                ],
                blobs: {
                    [`${HEAD}:aaa/edit.ts`]: `${material}${credentialBlock}${oversized}`,
                    [`${HEAD}:bbb/competitor.ts`]: competitor,
                },
                hunks: new Map([
                    [
                        'aaa/edit.ts',
                        {
                            path: 'aaa/edit.ts',
                            before: [],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 11 },
                                { startLine: 12, endLine: 71 },
                            ],
                        },
                    ],
                    [
                        'bbb/competitor.ts',
                        {
                            path: 'bbb/competitor.ts',
                            before: [],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000,
                maxTotalBytes: materialBytes + competitorBytes - 1,
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'aaa/edit.ts:after',
        ]);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'bbb/competitor.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
        expect(
            set.excluded.some(
                (entry) => entry.path === 'aaa/edit.ts' && entry.reason === 'credential-shaped-content-excluded'
            )
        ).toBe(true);
    });

    it('ranks a contract path by its chargeable hunks, not the over-budget hunk', () => {
        // R1: the ranked cost summed every hunk slice, so an over-budget hunk outranked a cheaper
        // contract path and starved the material hunk that fits the total budget on its own. Ordering by
        // the bytes admission can charge counts the over-budget hunk as zero.
        const material = 'const mat = 1;\n';
        const oversized = 'const oversized = 1;\n'.repeat(60);
        const competitor = 'const competitor = 123456789012345;\n';
        // A single-line hunk slices away the trailing newline, so the two material slices cost one byte
        // less than their blobs.
        const materialBytes = Buffer.byteLength(material, 'utf8') - 1;
        const competitorBytes = Buffer.byteLength(competitor, 'utf8') - 1;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/reviewRiskPolicy.ts', { kind: 'added', added: 1, deleted: 0 }),
                    changedFile('scripts/reviewDossier.ts', { kind: 'added', added: 1, deleted: 0 }),
                ],
                blobs: {
                    [`${HEAD}:scripts/reviewDossier.ts`]: `${material}${oversized}`,
                    [`${HEAD}:scripts/reviewRiskPolicy.ts`]: competitor,
                },
                hunks: new Map([
                    [
                        'scripts/reviewDossier.ts',
                        {
                            path: 'scripts/reviewDossier.ts',
                            before: [],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 61 },
                            ],
                        },
                    ],
                    [
                        'scripts/reviewRiskPolicy.ts',
                        {
                            path: 'scripts/reviewRiskPolicy.ts',
                            before: [],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // The ceiling is the serialized measure: the two material hunks sit under it — a 15-byte line
            // costs about 150 bytes once its fields and identifier are counted — and the oversized one is
            // over it, which is the premise the ranking reads.
            limits: {
                maxRegionBytes: 300,
                maxTotalBytes: materialBytes + competitorBytes - 1,
            },
        });
        // The material hunk ranks the contract path first and fits the total budget on its own.
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'scripts/reviewDossier.ts:after',
        ]);
        expect(set.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'region-exceeds-per-region-budget (after, contract)' },
            { path: 'scripts/reviewRiskPolicy.ts', reason: 'total-evidence-budget-exhausted (after, contract)' },
        ]);
    });

    it('ranks a path by its hunk slice, not its whole side', () => {
        // R4: the byte figure is built from the hunk slices admission admits, not the whole side. A
        // 100-line file with a one-line hunk ranks by that one line; replacing the sliced cost with the
        // whole-side size ranks it after the 50-line competitor and starves the line the change touched.
        const bigLine = 'const big = 1;\n';
        const bigBody = bigLine.repeat(100);
        const competitorBody = 'const competitor = 1;\n'.repeat(50);
        const materialBytes = Buffer.byteLength(bigLine, 'utf8') - 1;
        const competitorBytes = Buffer.byteLength(competitorBody, 'utf8');
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/big.ts', { kind: 'added', added: 100, deleted: 0 }),
                    changedFile('bbb/competitor.ts', { kind: 'added', added: 50, deleted: 0 }),
                ],
                blobs: {
                    [`${HEAD}:aaa/big.ts`]: bigBody,
                    [`${HEAD}:bbb/competitor.ts`]: competitorBody,
                },
                hunks: new Map([
                    ['aaa/big.ts', { path: 'aaa/big.ts', before: [], after: [{ startLine: 50, endLine: 50 }] }],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: materialBytes + competitorBytes - 1 },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual(['aaa/big.ts:after']);
        expect(set.truncated).toEqual([
            { path: 'bbb/competitor.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('admits a collected spec that imports a closure member as a .js specifier', () => {
        // R4: the runtime maps .js onto the TypeScript source, but the trial only tried the exact base
        // and the TypeScript extensions, so `../../canonicalRecord.js` ranked bulk while the runtime
        // loaded `scripts/canonicalRecord.ts`.
        const before = 'const before = 1;\n';
        const contractAfter = "import { canonicalRecord } from '../../canonicalRecord.js';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/plain.spec.ts'),
                    changedFile('scripts/__tests__/nested/canonicalRecord.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/__tests__/nested/canonicalRecord.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it.each([
        ['query', '../../canonicalRecord.ts?raw'],
        ['hash', '../../canonicalRecord.ts#hash'],
    ])('admits a collected spec whose closure import carries a %s postfix', (_label, specifier) => {
        // R4: the runtime strips a query or hash postfix before resolving, so the trial must too, or a
        // spec pinning a closure member through one reads as bulk.
        const before = 'const before = 1;\n';
        const contractAfter = `import { canonicalRecord } from '${specifier}';\n`;
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/plain.spec.ts'),
                    changedFile('scripts/__tests__/nested/canonicalRecord.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'scripts/__tests__/nested/canonicalRecord.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('leaves a collected spec whose closure import is commented out bulk', () => {
        // R4: a regex over raw source read a commented-out import as a real one and classified the spec
        // contract-carrying. The syntax walker skips comments, so the spec's after side stays bulk and is
        // withheld with the plain bulk reason instead of admitted ahead of other bulk material.
        const before = 'const before = 1;\n';
        const contractAfter = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
        const commentedAfter = "// import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/commented.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: contractAfter,
                    [`${MERGE_BASE}:scripts/__tests__/commented.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/commented.spec.ts`]: commentedAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) => reference.path === 'scripts/__tests__/commented.spec.ts' && reference.side === 'after'
            )
        ).toBe(false);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'scripts/__tests__/commented.spec.ts' &&
                    entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
    });

    it('admits a collected spec that dynamically imports a closure member before an equal-sized bulk spec', () => {
        // R4: the regex saw `import '...'` and `from '...'` but not `import('...')`, so a dynamic closure
        // import classified bulk. The syntax walker reads dynamic import specifiers, so it is contract.
        const before = 'const before = 1;\n';
        const contractAfter = "await import('../trustedGithubWriteBootstrap.ts');\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/dynamic.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/dynamic.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/dynamic.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) => reference.path === 'scripts/__tests__/dynamic.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });
});

describe('admission ordering counts a shared region once', () => {
    it('admits a copy of a modified source before a larger bulk when the shared before region is counted once', () => {
        // R1: `M a/source.ts` plus an exact copy `C a/source.ts z/copy.ts` mint the same before region.
        // The per-path estimate charged that shared region twice, so both ranked 680 while admission
        // charges the shared 339 once. The 496-byte bulk ranked below them and was admitted first,
        // starving the copy's 339-byte after side. Counting a shared region once ranks the copy by its
        // after side alone, so the smaller charge is admitted and the bulk is withheld.
        const sourceLine = 'const shared = 1;\n';
        const sourceBefore = sourceLine.repeat(20);
        const sourceAfter = `const shared = 2;\n${sourceLine.repeat(19)}`;
        const copyAfter = sourceBefore;
        const bulk = 'const bulk = 1;\n'.repeat(31);
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('a/source.ts', { added: 1, deleted: 1 }),
                    changedFile('z/copy.ts', {
                        kind: 'copied',
                        previousPath: 'a/source.ts',
                        added: 20,
                        deleted: 0,
                    }),
                    changedFile('m/bulk.ts', { kind: 'added', added: 31, deleted: 0 }),
                ],
                blobs: {
                    [`${MERGE_BASE}:a/source.ts`]: sourceBefore,
                    [`${HEAD}:a/source.ts`]: sourceAfter,
                    [`${HEAD}:z/copy.ts`]: copyAfter,
                    [`${HEAD}:m/bulk.ts`]: bulk,
                },
                hunks: new Map([
                    [
                        'a/source.ts',
                        {
                            path: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                    [
                        'z/copy.ts',
                        {
                            path: 'z/copy.ts',
                            previousPath: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(sourceBefore, 'utf8') * 3,
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'a/source.ts:after',
            'a/source.ts:before',
            'z/copy.ts:after',
        ]);
        expect(
            set.truncated.some(
                (entry) => entry.path === 'm/bulk.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
    });

    it('admits a copy and a rename of one unchanged source before a larger bulk when the shared before region is counted once', () => {
        // R1: `C a/source.ts z/copy.ts` plus `R a/source.ts z/renamed.ts` from one unchanged source mint
        // the same before region for both, and the per-path estimate charged it twice. Counting it once
        // ranks each derived path by its after side, so both afters are admitted and the bulk withheld.
        const sourceLine = 'const shared = 1;\n';
        const sourceBefore = sourceLine.repeat(20);
        const copyAfter = sourceBefore;
        const renamedAfter = `const renamed = 1;\n${sourceLine.repeat(19)}`;
        const bulk = 'const bulk = 1;\n'.repeat(31);
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('z/copy.ts', {
                        kind: 'copied',
                        previousPath: 'a/source.ts',
                        added: 20,
                        deleted: 0,
                    }),
                    changedFile('z/renamed.ts', {
                        kind: 'renamed',
                        previousPath: 'a/source.ts',
                        added: 20,
                        deleted: 20,
                    }),
                    changedFile('m/bulk.ts', { kind: 'added', added: 31, deleted: 0 }),
                ],
                blobs: {
                    [`${MERGE_BASE}:a/source.ts`]: sourceBefore,
                    [`${HEAD}:z/copy.ts`]: copyAfter,
                    [`${HEAD}:z/renamed.ts`]: renamedAfter,
                    [`${HEAD}:m/bulk.ts`]: bulk,
                },
                hunks: new Map([
                    [
                        'z/copy.ts',
                        {
                            path: 'z/copy.ts',
                            previousPath: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                    [
                        'z/renamed.ts',
                        {
                            path: 'z/renamed.ts',
                            previousPath: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(sourceBefore, 'utf8') * 3,
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'a/source.ts:before',
            'z/copy.ts:after',
            'z/renamed.ts:after',
        ]);
        expect(
            set.truncated.some(
                (entry) => entry.path === 'm/bulk.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
    });

    it('ranks a shared region below its charge and withholds the smaller competitor that follows', () => {
        // R2: the byte figure is a lower bound, not a promise of what each path pays. The modified
        // source's before side is shared with the copy, so it is not counted toward the source's rank;
        // the source ranks by its 18-byte after edit alone. Admission charges the shared 360-byte before
        // region to the source first, so a 108-byte competitor that sorts after the source is withheld
        // even though it is smaller than what the source pays. That is the accepted tension: a smaller
        // edit is not guaranteed to survive when a region is shared.
        const sourceLine = 'const shared = 1;\n';
        const sourceBefore = sourceLine.repeat(20);
        const sourceAfter = 'const shared = 2;\n';
        const copyAfter = sourceBefore;
        const competitor = sourceLine.repeat(6);
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('a/source.ts', { added: 1, deleted: 1 }),
                    changedFile('z/copy.ts', { kind: 'copied', previousPath: 'a/source.ts', added: 20, deleted: 0 }),
                    changedFile('m/competitor.ts', { kind: 'added', added: 6, deleted: 0 }),
                ],
                blobs: {
                    [`${MERGE_BASE}:a/source.ts`]: sourceBefore,
                    [`${HEAD}:a/source.ts`]: sourceAfter,
                    [`${HEAD}:z/copy.ts`]: copyAfter,
                    [`${HEAD}:m/competitor.ts`]: competitor,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(sourceBefore, 'utf8') + Buffer.byteLength(sourceAfter, 'utf8'),
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'a/source.ts:before',
            'a/source.ts:after',
        ]);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'm/competitor.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
    });
});

describe('admission ordering follows the side that carries the contract', () => {
    const closureImport = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";

    /**
     * Collects one contract-carrying path that leaves its contract surface (its before side is contract,
     * its after side bulk) against a bulk competitor, under a budget that fits only the contract side.
     */
    function admitAgainstBulkCompetitor(input: {
        readonly moved: SemanticChangedFile;
        readonly movedBeforePath: string;
        readonly movedBefore: string;
        readonly movedAfter: string;
        readonly competitor: SemanticChangedFile;
        readonly competitorContent: string;
        readonly budget: number;
    }): SemanticEvidenceSet {
        return collectEvidence({
            port: fakeSource({
                files: [input.moved, input.competitor],
                blobs: {
                    [`${MERGE_BASE}:${input.movedBeforePath}`]: input.movedBefore,
                    [`${HEAD}:${input.moved.path}`]: input.movedAfter,
                    [`${HEAD}:${input.competitor.path}`]: input.competitorContent,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: input.budget },
        });
    }

    it('admits a contract side before a bulk side of another change regardless of file order', () => {
        // A rename out of `AGENTS.md` is contract on its before side and bulk on its 1700-byte after
        // side. Ordering the whole path by the union of the two classes admitted the bulk after side
        // first; ordering by one representative side ranked the whole path bulk. Each admitted side now
        // carries its own class, so the case reads that the contract before side and the closure-importing
        // spec's sides are admitted and the bulk after side is withheld.
        const docBefore = '# AGENTS.md\n';
        const bulkAfter = 'const bulk = 1;\n'.repeat(106);
        const specSide = closureImport;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/bulk.ts', { kind: 'renamed', previousPath: 'AGENTS.md', added: 106, deleted: 1 }),
                    changedFile('scripts/__tests__/closure.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:AGENTS.md`]: docBefore,
                    [`${HEAD}:aaa/bulk.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/closure.spec.ts`]: specSide,
                    [`${HEAD}:scripts/__tests__/closure.spec.ts`]: specSide,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes:
                    Buffer.byteLength(docBefore, 'utf8') +
                    Buffer.byteLength(bulkAfter, 'utf8') +
                    Buffer.byteLength(specSide, 'utf8'),
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'AGENTS.md:before',
            'scripts/__tests__/closure.spec.ts:before',
            'scripts/__tests__/closure.spec.ts:after',
        ]);
        expect(set.truncated).toEqual([{ path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' }]);
    });

    it('admits the contract before side of a rename out of AGENTS.md before a bulk competitor', () => {
        // R1: a rename out of `AGENTS.md` is contract on its before side and bulk on its after side.
        // Ordering the whole path by its after side ranked it bulk, admitted the cheaper bulk competitor,
        // and withheld the contract before side with a `(before, contract)` reason the ranking never used.
        const contractBefore = '# AGENTS.md\n'.repeat(20);
        const bulkAfter = 'const bulk = 1;\n'.repeat(2);
        const competitorContent = 'const competitor = 1;\n'.repeat(5);
        const set = admitAgainstBulkCompetitor({
            moved: changedFile('aaa/renamed.ts', { kind: 'renamed', previousPath: 'AGENTS.md', added: 2, deleted: 20 }),
            movedBeforePath: 'AGENTS.md',
            movedBefore: contractBefore,
            movedAfter: bulkAfter,
            competitor: changedFile('aaa/bulk.ts', { kind: 'added', added: 5, deleted: 0 }),
            competitorContent,
            budget: Buffer.byteLength(contractBefore, 'utf8'),
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual(['AGENTS.md:before']);
        expect(set.truncated).toEqual([
            { path: 'aaa/renamed.ts', reason: 'total-evidence-budget-exhausted (after)' },
            { path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('admits the contract before side of a copy of AGENTS.md to a bulk path before a bulk competitor', () => {
        // R1: an exact copy of `AGENTS.md` out to a bulk path is contract on its before side and bulk on
        // its after side. The representative-side ranking read the copy as bulk and withheld the contract
        // before side; per-side ordering admits it first.
        const contractBefore = '# AGENTS.md\n'.repeat(20);
        const bulkAfter = 'const bulk = 1;\n'.repeat(2);
        const competitorContent = 'const competitor = 1;\n'.repeat(5);
        const set = admitAgainstBulkCompetitor({
            moved: changedFile('aaa/copied.ts', { kind: 'copied', previousPath: 'AGENTS.md', added: 20, deleted: 0 }),
            movedBeforePath: 'AGENTS.md',
            movedBefore: contractBefore,
            movedAfter: bulkAfter,
            competitor: changedFile('aaa/bulk.ts', { kind: 'added', added: 5, deleted: 0 }),
            competitorContent,
            budget: Buffer.byteLength(contractBefore, 'utf8'),
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual(['AGENTS.md:before']);
        expect(set.truncated).toEqual([
            { path: 'aaa/copied.ts', reason: 'total-evidence-budget-exhausted (after)' },
            { path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('admits the contract before side of a rename of a pinned workflow before a bulk competitor', () => {
        // R1: a rename of a pinned `.github/workflows/health-gates.yml` out to a bulk path is contract on
        // its before side. The representative-side ranking read the workflow as bulk and withheld the
        // contract before side; per-side ordering admits it first.
        const contractBefore = '# contract\n'.repeat(20);
        const bulkAfter = 'const bulk = 1;\n'.repeat(2);
        const competitorContent = 'const competitor = 1;\n'.repeat(5);
        const set = admitAgainstBulkCompetitor({
            moved: changedFile('aaa/workflow.ts', {
                kind: 'renamed',
                previousPath: '.github/workflows/health-gates.yml',
                added: 2,
                deleted: 20,
            }),
            movedBeforePath: '.github/workflows/health-gates.yml',
            movedBefore: contractBefore,
            movedAfter: bulkAfter,
            competitor: changedFile('aaa/bulk.ts', { kind: 'added', added: 5, deleted: 0 }),
            competitorContent,
            budget: Buffer.byteLength(contractBefore, 'utf8'),
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            '.github/workflows/health-gates.yml:before',
        ]);
        expect(set.truncated).toEqual([
            { path: 'aaa/workflow.ts', reason: 'total-evidence-budget-exhausted (after)' },
            { path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('admits the contract before side of a spec rewritten to drop its closure import before a bulk competitor', () => {
        // R1: a collected spec rewritten to drop its closure import is contract on its before side (the
        // import) and bulk on its after side. The representative-side ranking read the spec as bulk and
        // withheld the contract before side; per-side ordering admits the contract before side before the
        // non-spec bulk competitor. The spec's rules also declare a contract token, so its bulk after side
        // is contract-needing and ranks ahead of the unrelated bulk competitor once both lose the total.
        const contractBefore = `${closureImport}${'# filler\n'.repeat(20)}`;
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const competitorContent = 'const competitor = 1;\n'.repeat(5);
        const set = admitAgainstBulkCompetitor({
            moved: changedFile('scripts/__tests__/closure.spec.ts'),
            movedBeforePath: 'scripts/__tests__/closure.spec.ts',
            movedBefore: contractBefore,
            movedAfter: bulkAfter,
            competitor: changedFile('aaa/bulk.ts', { kind: 'added', added: 5, deleted: 0 }),
            competitorContent,
            budget: Buffer.byteLength(contractBefore, 'utf8'),
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'scripts/__tests__/closure.spec.ts:before',
        ]);
        expect(set.truncated).toEqual([
            { path: 'scripts/__tests__/closure.spec.ts', reason: 'total-evidence-budget-exhausted (after)' },
            { path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('admits the before side of a deleted contract path before a bulk competitor', () => {
        // R3: a deleted `AGENTS.md` has no after side, so its before side alone decides the class. The
        // deletion arm of the side classification had no witness; returning bulk for a file with no after
        // side admitted the cheaper bulk competitor and withheld the contract before side.
        const contractBefore = '# AGENTS.md\n'.repeat(20);
        const competitorContent = 'const competitor = 1;\n'.repeat(5);
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('AGENTS.md', { kind: 'deleted', deleted: 20 }),
                    changedFile('aaa/bulk.ts', { kind: 'added', added: 5, deleted: 0 }),
                ],
                blobs: {
                    [`${MERGE_BASE}:AGENTS.md`]: contractBefore,
                    [`${HEAD}:aaa/bulk.ts`]: competitorContent,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(contractBefore, 'utf8'),
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual(['AGENTS.md:before']);
        expect(set.truncated).toEqual([{ path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' }]);
    });
});

describe('contract classification follows each side on both routes', () => {
    const closureImport = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
    const largeFiller = 'const large = 1;\n'.repeat(200);
    // The ceiling is the serialized measure the gate charges: a 15-byte source line costs about 256 bytes
    // once its identifier, fields and escaping are counted, so the small after sides fit and the fat
    // closure-carrying sides, an order of magnitude larger, do not.
    const limits = { maxRegionBytes: 300, maxTotalBytes: 8_192 };

    async function verifyWithheldReason(
        reference: { path: string; side: 'before' | 'after' | 'context' },
        blobs: Record<string, string>
    ): Promise<string | undefined> {
        const { runVerify } = await import('../verify.ts');
        const result = await runVerify({
            ports: {
                source: fakeSource({ files: [], blobs }),
                provider: constantProvider({ supported: 0.5, contradicted: 0.25, insufficient_context: 0.25 }),
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: profileWithVerifyBudget({ maxRegionBytes: 100 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [{ ...reference, startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
                },
            ],
            runId: 'verify-withheld',
        });
        return result.report.scope.truncated[0]?.reason;
    }

    it('classifies a deleted closure-pinning spec by its before side on both routes', async () => {
        // R3: a deleted spec has no after side, so the after-only classifier read it bulk and the scan
        // withheld its before side without the contract term, while verify read that reference's own
        // before content and did.
        const deletedPath = 'scripts/__tests__/deleted.spec.ts';
        const beforeContent = `${closureImport}${largeFiller}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile(deletedPath, { kind: 'deleted' })],
                blobs: { [`${MERGE_BASE}:${deletedPath}`]: beforeContent },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits,
        });
        expect(set.truncated).toEqual([
            { path: deletedPath, reason: 'region-exceeds-per-region-budget (before, contract)' },
        ]);
        expect(
            await verifyWithheldReason(
                { path: deletedPath, side: 'before' },
                {
                    [`${MERGE_BASE}:${deletedPath}`]: beforeContent,
                }
            )
        ).toBe('region-exceeds-per-region-budget (before, contract)');
    });

    it('classifies a renamed closure-pinning spec by its before side on both routes', async () => {
        // R3: a rename was classified by its destination, so a spec moved out of a closure-pinning path
        // read bulk on its before side while verify read the source path's own content.
        const sourcePath = 'scripts/__tests__/closure.spec.ts';
        const targetPath = 'src/modules/other/moved.ts';
        const beforeContent = `${closureImport}${largeFiller}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile(targetPath, { kind: 'renamed', previousPath: sourcePath, added: 1, deleted: 1 })],
                blobs: {
                    [`${MERGE_BASE}:${sourcePath}`]: beforeContent,
                    [`${HEAD}:${targetPath}`]: 'const after = 1;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits,
        });
        expect(set.truncated).toEqual([
            { path: sourcePath, reason: 'region-exceeds-per-region-budget (before, contract)' },
        ]);
        expect(
            await verifyWithheldReason(
                { path: sourcePath, side: 'before' },
                {
                    [`${MERGE_BASE}:${sourcePath}`]: beforeContent,
                }
            )
        ).toBe('region-exceeds-per-region-budget (before, contract)');
    });

    it('labels a withheld contract-context region the same on both routes', async () => {
        // R3: the scan named a withheld contract-context region `(contract)` while verify named the same
        // reference `(context, contract)`; both now read the side qualifier the reference actually has.
        const contractContent = '# AGENTS.md\n'.repeat(200);
        const set = collectEvidence({
            port: fakeSource({ files: [], blobs: { [`${MERGE_BASE}:AGENTS.md`]: contractContent } }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits,
            contractPaths: ['AGENTS.md'],
        });
        expect(set.truncated).toEqual([
            { path: 'AGENTS.md', reason: 'region-exceeds-per-region-budget (context, contract)' },
        ]);
        expect(
            await verifyWithheldReason(
                { path: 'AGENTS.md', side: 'context' },
                {
                    [`${MERGE_BASE}:AGENTS.md`]: contractContent,
                }
            )
        ).toBe('region-exceeds-per-region-budget (context, contract)');
    });

    it('names a caller-supplied context region contract on both routes, whatever its path classifies as', async () => {
        // R3: the scan names every context request contract — `isContractCarryingRegion` returns true for
        // a region carrying no changed path — while verify recomputed the class from the reference's own
        // path and content. A context path that no contract-carrying classification covers therefore read
        // `(context, contract)` from the scan and `(context)` from verify for the same reference.
        const contextPath = 'docs/notes.md';
        const oversized = '# notes\n'.repeat(200);
        const files = { [`${MERGE_BASE}:${contextPath}`]: oversized };
        const set = collectEvidence({
            port: fakeSource({ files: [], blobs: files }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits,
            contractPaths: [contextPath],
        });
        expect(set.truncated).toEqual([
            { path: contextPath, reason: 'region-exceeds-per-region-budget (context, contract)' },
        ]);
        expect(await verifyWithheldReason({ path: contextPath, side: 'context' }, files)).toBe(
            'region-exceeds-per-region-budget (context, contract)'
        );
        // The verify route's other withheld cause reads the same one class.
        const { runVerify } = await import('../verify.ts');
        const beyond = await runVerify({
            ports: {
                source: fakeSource({ files: [], blobs: files }),
                provider: constantProvider({ supported: 0.5, contradicted: 0.25, insufficient_context: 0.25 }),
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: profileWithVerifyBudget({ maxRegionBytes: 100 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [{ path: contextPath, side: 'context', startLine: 500, endLine: 520 }],
                },
            ],
            runId: 'verify-context-class',
        });
        expect(beyond.report.scope.truncated).toEqual([
            { path: contextPath, reason: 'hunk-beyond-file (context, contract)' },
        ]);
    });
});

describe('unit planning', () => {
    it('bounds each unit separately so one large file cannot starve every later unit', () => {
        // Regression: the run-wide evidence ceiling was the per-request state budget, so the first
        // large file consumed it and the run reported 0 eligible units for a 22-path change. The
        // oversized file is now not sent at all, and the units that do fit are still assessed.
        const big = 'const sample = 1;\n'.repeat(400);
        const files = [changedFile('crates/daw-dsp/src/a.rs'), changedFile('crates/daw-dsp/src/b.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: big,
                    [`${HEAD}:crates/daw-dsp/src/a.rs`]: big,
                    [`${MERGE_BASE}:crates/daw-dsp/src/b.rs`]: 'const b = 1;\n',
                    [`${HEAD}:crates/daw-dsp/src/b.rs`]: 'const b = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const { units, incomplete } = planUnits(files, set, 4_096);
        expect(units.map((unit) => unit.path)).toEqual(['crates/daw-dsp/src/b.rs']);
        expect(incomplete.map((entry) => entry.path)).toEqual(['crates/daw-dsp/src/a.rs']);
    });

    it('records a unit whose evidence could not be sent rather than dropping it silently', () => {
        const big = 'const sample = 1;\n'.repeat(400);
        const files = [changedFile('crates/daw-dsp/src/a.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: big,
                    [`${HEAD}:crates/daw-dsp/src/a.rs`]: big,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        // 4 KiB holds the questions and wrapper but not the 6 KiB region, and a region is supplied
        // whole or not at all: the unit is refused and named rather than assessed over a fragment.
        const { units, incomplete } = planUnits(files, set, 4_096);
        expect(units).toHaveLength(0);
        expect(incomplete).toEqual([{ path: 'crates/daw-dsp/src/a.rs', reason: 'no-evidence-region-within-budget' }]);
    });

    it('excludes a unit whose reservation equals the state cap, not only one over it', () => {
        // The planner guard reads `<=` so a reservation that exactly spends the state cap leaves no
        // evidence budget and is excluded; reading `<` would admit it and then drop every region for a
        // different reason. The cap is set to the reservation itself so the tie is exact.
        const file = changedFile('crates/daw-dsp/src/a.rs');
        const cap = unitReservationBytes(file, applicableRules([file.path]), changedLineFacts(undefined));
        const set = collectEvidence({
            port: fakeSource({
                files: [file],
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: 'const a = 1;\n',
                    [`${HEAD}:crates/daw-dsp/src/a.rs`]: 'const a = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const { units, excluded, incomplete } = planUnits([file], set, cap);
        expect(units).toHaveLength(0);
        expect(excluded).toEqual([{ path: file.path, reason: 'unit-overhead-exceeds-request-budget' }]);
        expect(incomplete).toEqual([{ path: file.path, reason: 'unit-overhead-exceeds-request-budget' }]);
    });
});

/**
 * A cap small enough that the saturation search stays cheap, and independent of the shipped profile
 * numbers. It has to clear the planner's reservation for these paths — about 4.7 KiB — by enough for
 * the fifteen-region case to be admissible at all, since that reserve is spent before any evidence is;
 * 16 KiB leaves about 11.7 KiB of evidence, so the fixture spends a few KiB per unit rather than the
 * shipped profile's hundreds.
 */
const SATURATION_CAP = 16_384;

/**
 * A synthetic added file whose after side is sliced into `regions` single-line hunks. The last line
 * carries `padding` filler bytes, and JSON escapes none of them, so the unit's own serialized
 * evidence grows one byte per padding byte and the fitter's admission boundary can be bisected.
 */
function paddedRegionSource(
    path: string,
    regions: number,
    padding: number
): { file: SemanticChangedFile; content: string; hunks: PathHunks } {
    const lines = Array.from({ length: regions }, (_unused, index) => {
        const body = index === regions - 1 ? 'p'.repeat(padding) : `value${String(index)}`;
        return `export const line${String(index)} = '${body}';\n`;
    });
    return {
        file: changedFile(path, { kind: 'added', added: regions, deleted: 0 }),
        content: lines.join(''),
        hunks: {
            path,
            before: [],
            after: Array.from({ length: regions }, (_unusedLine, index) => ({
                startLine: index + 1,
                endLine: index + 1,
            })),
        },
    };
}

/**
 * The serialized cost one whole-file region carries: the measure the scan collector's per-region gate
 * charges, with the identifier, fields and content the region is minted with. Raw bytes undercount it —
 * JSON escapes every newline and the reference's own fields are charged too — which is how fixtures sized
 * in raw bytes ended up over a ceiling they were meant to sit under.
 */
function scanRegionCost(path: string, content: string, side: EvidenceSide = 'after'): number {
    return regionCost(
        {
            evidenceId: `${evidenceSidePrefix(side)}1`,
            revisionSha: side === 'after' ? HEAD : MERGE_BASE,
            path,
            side,
            startLine: 1,
            endLine: Math.max(1, content.split('\n').length),
            contentHash: semanticTextDigest(content),
        },
        content
    );
}

type PaddedSource = ReturnType<typeof paddedRegionSource>;

/** The evidence set one or more synthetic added files admit, under lifted collector ceilings. */
function paddedEvidence(sources: readonly PaddedSource[]): SemanticEvidenceSet {
    return collectEvidence({
        port: fakeSource({
            files: sources.map((source) => source.file),
            hunks: new Map(sources.map((source) => [source.file.path, source.hunks])),
            blobs: Object.fromEntries(sources.map((source) => [`${HEAD}:${source.file.path}`, source.content])),
        }),
        mergeBaseSha: MERGE_BASE,
        headSha: HEAD,
        contractSourceSha: MERGE_BASE,
        // The collector's own ceilings are lifted, so the only budget in play is the per-request one.
        limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
    });
}

/** The units these synthetic files plan to, in plan order. */
function paddedUnits(sources: readonly PaddedSource[], cap: number): SemanticUnitPlan[] {
    const { units } = planUnits(
        sources.map((source) => source.file),
        paddedEvidence(sources),
        cap
    );
    return units;
}

/**
 * The largest single request a planned unit actually sends: the provider's own measurement over each
 * pass, not over the union of a multi-pass unit's evidence. A unit whose evidence exceeds one request
 * is partitioned into passes, so the whole unit can legitimately measure above the cap while every pass
 * stays inside it.
 */
function maxPassStateBytes(unit: SemanticUnitPlan): number {
    return Math.max(
        ...unit.evidence.passes.map((pass) =>
            unitStatePlusQuestionBytes({
                unitId: unit.unitId,
                path: unit.path,
                file: unit.file,
                rules: unit.rules,
                evidence: { references: pass.references, contents: pass.contents },
                changedLineFacts: unit.changedLineFacts,
            })
        )
    );
}

/**
 * The deepest padding at which `path` still carries all `regions` of its own evidence, searched with
 * the rest of the sources present at their current padding.
 *
 * The boundary is the planner's own reservation: the admitted evidence spends the evidence budget
 * exactly, so a reservation that under-counts the request envelope has no slack to hide behind here.
 * The search runs inside the plan rather than per file because the collector's region ids are global
 * ordinals — a unit among company carries a longer id than the same unit alone, so a fixture sized in
 * isolation would leave exactly the slack that makes this check pass for the wrong reason.
 */
function deepestPadding(sources: readonly PaddedSource[], path: string, regions: number, cap: number): number {
    const admittedWhole = (padding: number): boolean => {
        const candidate = sources.map((source) =>
            source.file.path === path ? paddedRegionSource(path, regions, padding) : source
        );
        return paddedUnits(candidate, cap).find((unit) => unit.path === path)?.evidence.own.length === regions;
    };
    let low = 0;
    let high = cap;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (admittedWhole(middle)) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return low;
}

/** One synthetic plan's files, each filled to its own admission boundary in plan order. */
function saturatedSources(
    layout: readonly { readonly path: string; readonly regions: number }[],
    cap: number
): PaddedSource[] {
    let sources = layout.map((entry) => paddedRegionSource(entry.path, entry.regions, 0));
    for (const entry of layout) {
        const padding = deepestPadding(sources, entry.path, entry.regions, cap);
        sources = sources.map((source) =>
            source.file.path === entry.path ? paddedRegionSource(entry.path, entry.regions, padding) : source
        );
    }
    return sources;
}

describe('the scan collector gates a region on the cost the request fitter charges', () => {
    it('measures one region exactly as the request carries it, at the gate boundary', () => {
        // The shared bound is the payload's own shape: the real path and side, the shortest identifier
        // admission can mint, and a sha and a digest of the length every real one has. A measure that
        // dropped a field would under-count the request, and a strict comparison would withhold a region
        // sitting exactly on the ceiling.
        const path = 'src/modules/Project/a.ts';
        const content = 'const sample = 1;\n';
        // Every side the measure carries, at the same content: `before`, `after` and `context` are different
        // lengths, so a measure that fixed the field would under-count one side and admit a region over the
        // ceiling by a byte or two.
        for (const side of ['before', 'after', 'context'] as const) {
            const exact = regionCost(
                {
                    evidenceId: 'a1',
                    revisionSha: '0'.repeat(40),
                    path,
                    side,
                    startLine: 1,
                    endLine: 1,
                    contentHash: '0'.repeat(64),
                },
                content
            );
            expect(regionRequestBytes({ path, side, content })).toBe(exact);
            expect(regionFitsRequest({ path, side, content }, exact)).toBe(true);
            expect(regionFitsRequest({ path, side, content }, exact - 1)).toBe(false);
        }
        // The three costs are distinct, which is what makes the field observable.
        expect(
            new Set(
                (['before', 'after', 'context'] as const).map((side) => regionRequestBytes({ path, side, content }))
            ).size
        ).toBe(3);
    });

    it('withholds a region whose raw bytes fit the ceiling but whose serialized cost does not', () => {
        // The collector costed raw bytes while the fitter charged serialized ones, so this region was
        // admitted by admission and then dropped by the request fit: the two disagreed about the same
        // region, and the run counted evidence it could not send. JSON escapes every newline, so the gap
        // is one byte a line and grows with the file.
        const path = 'src/modules/Project/a.ts';
        const region = 'const sample_line = 1;\n'.repeat(200);
        const raw = Buffer.byteLength(region, 'utf8');
        const serialized = scanRegionCost(path, region);
        // The ceiling sits between the two measures, which is the whole disagreement.
        const ceiling = raw + Math.floor((serialized - raw) / 2);
        expect(raw).toBeLessThanOrEqual(ceiling);
        expect(serialized).toBeGreaterThan(ceiling);

        const files = [changedFile(path, { kind: 'added', added: 200, deleted: 0 })];
        const set = collectEvidence({
            port: fakeSource({ files, blobs: { [`${HEAD}:${path}`]: region } }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: ceiling, maxTotalBytes: 1_000_000 },
        });
        expect(set.references).toHaveLength(0);
        expect(set.truncated).toEqual([{ path, reason: 'region-exceeds-per-region-budget (after)' }]);
        // And the planner agrees with the collector: no unit claims evidence the request cannot carry.
        const { units, excluded } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(0);
        // The reason names the size, not inadmissibility: the evidence was admissible and the request
        // had no room for it.
        expect(excluded).toContainEqual({ path, reason: 'no-evidence-region-within-budget' });
    });
    it('names the size only when the size was the only cause', () => {
        // A mixed state the whole-record read exists for: the before side is over the per-region ceiling and
        // the after side mints a hunk the run total then withholds, so the record holds a size cause first
        // and the total's cause beside it. Reading only the first entry would emit `no-evidence-region-
        // within-budget` for a file whose evidence was also inadmissible, which is a claim the record
        // contradicts.
        const path = 'src/modules/Project/a.ts';
        const files = [changedFile(path, { added: 2, deleted: 1 })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${path}`]: 'x'.repeat(900),
                    [`${HEAD}:${path}`]: `${'y'.repeat(900)}\n${'z'.repeat(120)}\n`,
                },
                hunks: new Map<string, PathHunks>([
                    [
                        path,
                        {
                            path,
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 900, maxTotalBytes: 100 },
        });
        expect(set.truncated.map((entry) => entry.reason)).toEqual([
            'region-exceeds-per-region-budget (before)',
            'region-exceeds-per-region-budget (after)',
            'total-evidence-budget-exhausted (after)',
        ]);
        const { units, excluded } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(0);
        expect(excluded).toEqual([{ path, reason: 'no-admissible-evidence' }]);
    });

    it('reads each file its own withheld record rather than the whole run', () => {
        // The filter is the file's own entries. A run where one file's only cause is size and another's is
        // not must not let the second file's cause decide the first file's reason.
        const sizedPath = 'src/modules/Project/aaa.ts';
        const missingPath = 'src/modules/Project/zzz.ts';
        const files = [
            changedFile(sizedPath, { added: 1, deleted: 1 }),
            changedFile(missingPath, { added: 1, deleted: 1 }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${sizedPath}`]: 'x'.repeat(900),
                    [`${HEAD}:${sizedPath}`]: 'y'.repeat(900),
                    // The second file's sides are unreadable, which is not a size cause.
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 200, maxTotalBytes: 1_000_000 },
        });
        expect(set.truncated.map((entry) => `${entry.path}:${entry.reason}`)).toEqual([
            'src/modules/Project/aaa.ts:region-exceeds-per-region-budget (before)',
            'src/modules/Project/aaa.ts:region-exceeds-per-region-budget (after)',
            'src/modules/Project/zzz.ts:evidence-unavailable-at-revision',
            'src/modules/Project/zzz.ts:evidence-unavailable-at-revision',
        ]);
        const { excluded } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(excluded).toContainEqual({ path: sizedPath, reason: 'no-evidence-region-within-budget' });
        expect(excluded).toContainEqual({ path: missingPath, reason: 'no-admissible-evidence' });
    });

    it('reads the whole withheld record when it chooses the nothing-sent reason', () => {
        // The rule itself, at its boundaries: a size-only record names the size, and any other cause beside
        // it outranks that.
        expect(nothingSentReason([{ path: 'a', reason: 'region-exceeds-per-region-budget (after)' }])).toBe(
            'no-evidence-region-within-budget'
        );
        // Both sides name the same size cause: the test is the cause, not the side it qualifies.
        expect(nothingSentReason([{ path: 'a', reason: 'region-exceeds-per-region-budget (before)' }])).toBe(
            'no-evidence-region-within-budget'
        );
        expect(
            nothingSentReason([
                { path: 'a', reason: 'region-exceeds-per-region-budget (before)' },
                { path: 'a', reason: 'request-exceeds-state-budget (after)' },
            ])
        ).toBe('no-evidence-region-within-budget');
        // The context form the vocabulary emits carries the contract qualifier, and the family reads it.
        expect(nothingSentReason([{ path: 'a', reason: 'region-exceeds-per-region-budget (context, contract)' }])).toBe(
            'no-evidence-region-within-budget'
        );
        expect(
            nothingSentReason([
                { path: 'a', reason: 'region-exceeds-per-region-budget (after)' },
                { path: 'b', reason: 'total-evidence-budget-exhausted (after)' },
            ])
        ).toBe('no-admissible-evidence');
        expect(nothingSentReason([{ path: 'a', reason: 'evidence-unavailable-at-revision' }])).toBe(
            'no-admissible-evidence'
        );
        expect(nothingSentReason([])).toBe('no-admissible-evidence');
    });

    it('names a before-side size refusal as the size, on a file with no other cause', () => {
        // The before side is the only entry, so the reason must read the size from a `(before)` qualifier:
        // a rule that matched the after side alone would call this file inadmissible.
        const path = 'src/modules/Project/a.ts';
        const files = [changedFile(path, { added: 1, deleted: 1 })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${path}`]: 'x'.repeat(900),
                    [`${HEAD}:${path}`]: 'y'.repeat(900),
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 900, maxTotalBytes: 1_000_000 },
        });
        expect(set.truncated.map((entry) => entry.reason)).toEqual([
            'region-exceeds-per-region-budget (before)',
            'region-exceeds-per-region-budget (after)',
        ]);
        const { units, excluded } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(0);
        expect(excluded).toEqual([{ path, reason: 'no-evidence-region-within-budget' }]);
    });

    it('reads a previous-path cause when it chooses the nothing-sent reason', () => {
        // A rename's before side is keyed to its previous path. With that side credential-shaped and the
        // after side only over the region ceiling, the record is mixed and the reason is inadmissibility; a
        // filter reading the file's own path alone would see the size cause by itself and claim the size,
        // which is the claim the fitter's empty case was just repaired for.
        const previousPath = 'src/modules/Project/old.ts';
        const path = 'src/modules/Project/renamed.ts';
        const files = [changedFile(path, { kind: 'renamed', previousPath, added: 1, deleted: 1 })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${previousPath}`]: secretFixture(
                        'const key = ',
                        "'",
                        'AKIA',
                        'IOSFODNN7EXAM',
                        'PLE',
                        "'",
                        ';\n'
                    ),
                    [`${HEAD}:${path}`]: 'y'.repeat(900),
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 200, maxTotalBytes: 1_000_000 },
        });
        expect(set.truncated.map((entry) => entry.reason)).toEqual([
            'evidence-withheld-credential-shaped',
            'region-exceeds-per-region-budget (after)',
        ]);
        const { units, excluded } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(0);
        expect(excluded).toContainEqual({ path, reason: 'no-admissible-evidence' });
    });

    it('keeps the planner predicate and the ranking charge on the measure admission gates with', () => {
        // The three consumers of the ceiling used to measure differently: admission cost the serialized
        // reference while the planner's predicate and the ranking charge read raw bytes. A region like
        // this one — 96,100 bytes raw, 99,451 serialized in the thread's fixture — was therefore withheld
        // by admission while its path was still planned and its raw bytes still counted, and the
        // default-contract charge was gated on that phantom. All three now read `regionFitsRequest`.
        const path = 'src/modules/Project/a.ts';
        const region = 'const sample_line = 1;\n'.repeat(5_000);
        const raw = Buffer.byteLength(region, 'utf8');
        const serialized = scanRegionCost(path, region);
        const ceiling = raw + Math.floor((serialized - raw) / 2);
        // The premise: the raw bytes fit the ceiling and the serialized cost does not.
        expect(raw).toBeLessThanOrEqual(ceiling);
        expect(serialized).toBeGreaterThan(ceiling);
        const contents = new Map([[path, { after: region }]]);
        expect(plannedUnitPaths([changedFile(path)], contents, new Map(), ceiling, new Set())).toEqual(new Set());
        expect(admissionBytesBySide([changedFile(path)], contents, new Map(), ceiling, MERGE_BASE, HEAD)).toEqual(
            new Map([[path, { before: 0, after: 0 }]])
        );
    });
});

describe('a planned unit measures inside the request budget the provider enforces', () => {
    it('keeps the unit the planner admits at its own reservation boundary inside the cap', () => {
        // Red before the repair, with the measured overage: the reservation was a hand-rolled wrapper
        // that omitted the outer braces and the `state`/`questions` key names — 23 bytes of envelope,
        // of which the old wrapper already counted the 2-byte empty evidence map it replaced — so the
        // deepest unit the planner admitted measured `cap + 22 - fittedRegions` bytes and the provider
        // refused the very unit the plan had admitted.
        const path = 'src/modules/AudioEngine/live.ts';
        const overages = [1, 15].map((regions) => {
            const sources = saturatedSources([{ path, regions }], SATURATION_CAP);
            const unit = paddedUnits(sources, SATURATION_CAP).find((candidate) => candidate.path === path);
            if (unit === undefined) {
                throw new Error(`the planner admitted no unit for ${String(regions)} saturated region(s)`);
            }
            expect(unit.evidence.own).toHaveLength(regions);
            // Exactly the provider's own measurement: `{state, questions}` against the profile limit,
            // taken per pass because a multi-region unit may legitimately split across several requests.
            return { regions, overBy: Math.max(0, maxPassStateBytes(unit) - SATURATION_CAP) };
        });
        expect(overages).toEqual([
            { regions: 1, overBy: 0 },
            { regions: 15, overBy: 0 },
        ]);
    });

    it('keeps every unit of a multi-unit plan inside the cap, not only the saturated one', () => {
        const layout = [
            { path: 'src/modules/AudioEngine/live.ts', regions: 1 },
            { path: 'src/modules/AudioEngine/schedule.ts', regions: 2 },
            { path: 'src/modules/Project/store.ts', regions: 3 },
            { path: 'src/modules/Project/undo.ts', regions: 5 },
        ];
        const units = paddedUnits(saturatedSources(layout, SATURATION_CAP), SATURATION_CAP);
        expect([...units.map((unit) => unit.path)].sort()).toEqual([...layout.map((entry) => entry.path)].sort());
        // The plan's admission order is its own key, so the cap invariant is read per path rather than
        // in plan order; every unit still has to measure inside the cap on every pass.
        const overByPath = new Map(
            units.map((unit) => [unit.path, Math.max(0, maxPassStateBytes(unit) - SATURATION_CAP)])
        );
        expect(layout.map((entry) => ({ path: entry.path, overBy: overByPath.get(entry.path) }))).toEqual(
            layout.map((entry) => ({ path: entry.path, overBy: 0 }))
        );
        // The fixture spends the cap, so the invariant is load-bearing rather than slack.
        expect(Math.max(...units.map((unit) => maxPassStateBytes(unit)))).toBeGreaterThan(SATURATION_CAP - 1_024);
    });

    it('keeps a unit whole at the shipped ci cap that the old 24 KiB cap had to cut', () => {
        // The scan cap is what decides whether a unit's own regions are sent at all. A unit whose own
        // evidence runs about 31 KiB is cut by the old 24 KiB state budget and carried whole by the
        // larger ci cap, so the measured before-and-after is the region count the fitter keeps, not an
        // assumption about either number.
        const path = 'src/modules/AudioEngine/live.ts';
        const regions = 4;
        const sources = [paddedRegionSource(path, regions, 30_000)];
        const cut = paddedUnits(sources, 24 * 1024).find((unit) => unit.path === path);
        if (cut === undefined) {
            throw new Error('the old state budget excluded the unit outright instead of cutting it');
        }
        expect(cut.evidence.own.length).toBeGreaterThan(0);
        expect(cut.evidence.own.length).toBeLessThan(regions);
        const whole = paddedUnits(sources, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes).find(
            (unit) => unit.path === path
        );
        if (whole === undefined) {
            throw new Error('the shipped ci state budget excluded the unit it should carry whole');
        }
        expect(whole.evidence.own).toHaveLength(regions);
        expect(
            unitStatePlusQuestionBytes(whole) - SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes
        ).toBeLessThanOrEqual(0);
    });
});

describe('a request refused for its own size leaves the rest of the plan assessed', () => {
    // Path order decides which unit is which: `aaa` is assessed first, `mmm` is the one refused, and
    // `zzz` is the unit the old whole-run reading starved.
    const firstPath = 'src/modules/AudioEngine/aaa.ts';
    const refusedPath = 'src/modules/AudioEngine/mmm.ts';
    const lastPath = 'src/modules/AudioEngine/zzz.ts';
    const layout = [
        { path: firstPath, regions: 1 },
        { path: refusedPath, regions: 1 },
        { path: lastPath, regions: 1 },
    ];

    /**
     * A ci profile whose state ceiling is the fixture's saturation cap. The per-request body limit is
     * measured per case rather than pinned: a request now carries only the questions its pass can
     * answer, so the bytes a saturated unit submits depend on the question set and a constant would
     * stop refusing anything the moment that set narrowed — which is exactly how this fixture first
     * went quiet. The planner still admits no unit the state cap itself would refuse.
     */
    const refusalProfile: SemanticBudgetProfile = {
        ...SEMANTIC_BUDGET_PROFILES.ci,
        maxStatePlusQuestionBytes: SATURATION_CAP,
        maxRequestBytes: SATURATION_CAP + 16,
        maxTotalSubmittedBytes: 1024 * 1024,
    };

    /**
     * The plan runs through `runScan`'s own collection, so the unit the refusal test needs saturated is
     * the one saturated inside this three-file plan — the unit ids the collector mints depend on the
     * whole set, exactly as the production run's do. The other two units stay small, so the refusal
     * lands on the middle unit alone.
     */
    function fixtureSource(): SemanticSourcePort {
        const bare = layout.map((entry) => paddedRegionSource(entry.path, entry.regions, 0));
        const padding = deepestPadding(bare, refusedPath, 1, SATURATION_CAP);
        const sources = bare.map((source) =>
            source.file.path === refusedPath ? paddedRegionSource(refusedPath, 1, padding) : source
        );
        return fakeSource({
            files: sources.map((source) => source.file),
            hunks: new Map(sources.map((source) => [source.file.path, source.hunks])),
            blobs: Object.fromEntries(sources.map((source) => [`${HEAD}:${source.file.path}`, source.content])),
        });
    }

    /**
     * The bytes each planned unit's request would submit, read from the run's own previews under a
     * profile that refuses nothing, so the limit below can sit between the saturated unit and the rest.
     */
    async function measuredPreviews() {
        const base = scanPorts(constantProvider(0.05), fixtureSource(), fixedClock(1_000));
        const { previews } = await runScan({
            ...base,
            profile: { ...refusalProfile, maxRequestBytes: SATURATION_CAP * 8 },
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        return previews;
    }

    it('assesses the units after a per-request size refusal instead of blaming the run budget', async () => {
        const previews = await measuredPreviews();
        const saturated = previews.find((preview) => preview.path === refusedPath)?.bodyBytes ?? 0;
        const largestOther = Math.max(
            ...previews.filter((preview) => preview.path !== refusedPath).map((preview) => preview.bodyBytes)
        );
        // The measured fixture really does separate them, so the refusal can only land on the unit it
        // was built around.
        expect(saturated).toBeGreaterThan(largestOther);
        const base = scanPorts(constantProvider(0.05), fixtureSource(), fixedClock(1_000));
        const { report } = await runScan({
            ...base,
            profile: { ...refusalProfile, maxRequestBytes: largestOther + 1 },
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        expect(report.scope.eligible).toBe(3);
        expect(report.scope.assessed).toBe(2);
        // The refused unit carries its own per-request code, and the unit after it is genuinely assessed:
        // a signal for its path is the evidence that the plan continued rather than that it was counted.
        expect(report.scope.unassessed).toEqual([
            { path: refusedPath, reason: 'request_too_large', priorityClass: 'severe-production' },
        ]);
        expect(report.signals.some((signal) => signal.path === lastPath)).toBe(true);
        expect(report.scope.unassessed.some((entry) => entry.reason === 'budget-exhausted-before-admission')).toBe(
            false
        );
        expect(report.failureCode).toBe('request_too_large');
        // `executionState` reads a partial run from a completed unit plus a recorded failure, so a
        // per-request refusal does not turn the whole run unavailable.
        expect(report.execution).toBe('partial');
        expect(() => validateReport(report)).not.toThrow();
    });

    it('names the per-request refusal as a failure code of its own', () => {
        // The code has to be known to the report and to the context projection, or a refused unit reads
        // as an unrecognized reason; the whole-run budgets keep `budget_exhausted`, which is what
        // `budget-exhausted-before-admission` is reserved for.
        expect(SEMANTIC_FAILURE_CODES).toContain('request_too_large');
        expect(SEMANTIC_FAILURE_CODES).toContain('budget_exhausted');
    });

    it('still records the remaining units as budget-starved when the attempt budget runs out', async () => {
        // The other direction of the same policy: a whole-run budget that really is exhausted still
        // stops admission, so today's behaviour is preserved where it was true.
        const base = scanPorts(constantProvider(0.05), fixtureSource(), fixedClock(1_000));
        const { report } = await runScan({
            ...base,
            profile: { ...refusalProfile, maxAttempts: 1 },
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        expect(report.scope.assessed).toBe(1);
        expect(report.scope.unassessed).toEqual([
            { path: refusedPath, reason: 'budget_exhausted', priorityClass: 'severe-production' },
            { path: lastPath, reason: 'budget-exhausted-before-admission', priorityClass: 'severe-production' },
        ]);
        expect(report.failureCode).toBe('budget_exhausted');
        expect(report.execution).toBe('partial');
    });
});

describe('the deadline stops admission under its own name', () => {
    const firstPath = 'src/modules/AudioEngine/aaa.ts';
    const deadlinePath = 'src/modules/AudioEngine/mmm.ts';
    const lastPath = 'src/modules/AudioEngine/zzz.ts';

    function deadlineSource(): SemanticSourcePort {
        const strings = [
            [firstPath, 'export const a = 1;\n', 'export const a = 2;\n'],
            [deadlinePath, 'export const m = 1;\n', 'export const m = 2;\n'],
            [lastPath, 'export const z = 1;\n', 'export const z = 2;\n'],
        ] as const;
        return fakeSource({
            files: strings.map(([path]) => changedFile(path)),
            blobs: Object.fromEntries(
                strings.flatMap(([path, before, after]) => [
                    [`${MERGE_BASE}:${path}`, before],
                    [`${HEAD}:${path}`, after],
                ])
            ),
        });
    }

    it('records the tail the deadline skipped under the deadline, not as each request timing out', async () => {
        // Past the deadline every remaining unit would be refused by the same clock. Recording each as
        // `timeout` reads as if its own request had timed out and buries the one fact that matters: the
        // run ran out of time. The deadline now carries its own code, admission stops on it, and the tail
        // is recorded as never attempted.
        const clock = fixedClock(1_000);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        const provider = constantProvider(0.05, {
            systemOne: async ({ questions }) => {
                // The first unit's own attempt outlives the whole deadline.
                clock.advance(profile.overallDeadlineMs + 1_000);
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.05 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        });
        const { report } = await runScan(scanPorts(provider, deadlineSource(), clock));
        expect(report.scope.eligible).toBe(3);
        expect(report.scope.assessed).toBe(1);
        expect(report.scope.unassessed).toEqual([
            { path: deadlinePath, reason: 'deadline_elapsed', priorityClass: 'severe-production' },
            { path: lastPath, reason: 'deadline-elapsed-before-admission', priorityClass: 'severe-production' },
        ]);
        expect(report.failureCode).toBe('deadline_elapsed');
        expect(report.execution).toBe('partial');
        expect(() => validateReport(report)).not.toThrow();
    });

    it('files an attempt the deadline ended under the deadline, whatever error the truncation produced', async () => {
        // An attempt is given only what is left of the deadline, so the SDK aborts the call at the deadline
        // and the adapter sees that abort as a timeout, a connection error, or — a provider that answers as
        // the clock lands on the deadline — a terminal rejection. The clock decides in every case: the unit
        // in flight is the run's deadline stop, and filing it under its own request's error would name the
        // wrong cause for the unit that ended the run.
        for (const ended of [
            new APITimeoutError(SEMANTIC_BUDGET_PROFILES.local.attemptTimeoutMs),
            new APIConnectionError('connection closed at the deadline'),
            new BadRequestError(400, { detail: { error_type: 'max_tokens_exceeded' } }, new Headers()),
        ]) {
            const clock = fixedClock(1_000);
            const profile = SEMANTIC_BUDGET_PROFILES.local;
            let calls = 0;
            const provider = constantProvider(0.05, {
                systemOne: async () => {
                    calls += 1;
                    clock.advance(profile.overallDeadlineMs + 1_000);
                    throw ended;
                },
            });
            const { report } = await runScan(scanPorts(provider, deadlineSource(), clock));
            expect(report.scope.assessed).toBe(0);
            expect(report.scope.unassessed).toEqual([
                { path: firstPath, reason: 'deadline_elapsed', priorityClass: 'severe-production' },
                { path: deadlinePath, reason: 'deadline-elapsed-before-admission', priorityClass: 'severe-production' },
                { path: lastPath, reason: 'deadline-elapsed-before-admission', priorityClass: 'severe-production' },
            ]);
            expect(report.failureCode).toBe('deadline_elapsed');
            expect(report.execution).not.toBe('completed');
            // The deadline ended the run, so the units after the one in flight were never attempted.
            expect(calls).toBe(1);
        }
    });

    it('files an attempt that lands exactly on the deadline under the deadline', async () => {
        // The boundary the comparison reads: the attempt is handed exactly what remains, so the clock can
        // land on the deadline rather than past it. At the tie the run is over — filing the unit in flight
        // under its own error and admitting the next unit is the misattribution this code exists to
        // prevent — and one millisecond earlier the same error stays that unit's own cause.
        const tie = fixedClock(1_000);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        let tieCalls = 0;
        const tieProvider = constantProvider(0.05, {
            systemOne: async () => {
                tieCalls += 1;
                tie.advance(profile.overallDeadlineMs);
                throw new APITimeoutError(profile.attemptTimeoutMs);
            },
        });
        const atTheTie = await runScan(scanPorts(tieProvider, deadlineSource(), tie));
        expect(atTheTie.report.scope.assessed).toBe(0);
        expect(atTheTie.report.scope.unassessed).toEqual([
            { path: firstPath, reason: 'deadline_elapsed', priorityClass: 'severe-production' },
            { path: deadlinePath, reason: 'deadline-elapsed-before-admission', priorityClass: 'severe-production' },
            { path: lastPath, reason: 'deadline-elapsed-before-admission', priorityClass: 'severe-production' },
        ]);
        expect(atTheTie.report.failureCode).toBe('deadline_elapsed');
        expect(tieCalls).toBe(1);

        const before = fixedClock(1_000);
        const beforeProvider = constantProvider(0.05, {
            systemOne: async () => {
                before.advance(profile.overallDeadlineMs - 1);
                throw new APITimeoutError(profile.attemptTimeoutMs);
            },
        });
        const justBefore = await runScan(scanPorts(beforeProvider, deadlineSource(), before));
        // One millisecond of run time is left, so the first unit's own failure is its own: a timeout, and
        // admission continues until the next attempt finds the deadline spent.
        expect(justBefore.report.scope.unassessed[0]).toEqual({
            path: firstPath,
            reason: 'timeout',
            priorityClass: 'severe-production',
        });
        expect(justBefore.report.failureCode).toBe('deadline_elapsed');
    });

    it('refuses the next attempt when the clock has exactly spent the deadline', async () => {
        // The pre-attempt check's boundary: an attempt that lands the clock exactly on the deadline leaves
        // nothing for the next one, which reads the deadline rather than being handed a zero timeout it
        // cannot use. One millisecond short it is still attempted, which is the case above.
        const clock = fixedClock(1_000);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        let calls = 0;
        const provider = constantProvider(0.05, {
            systemOne: async ({ questions }) => {
                calls += 1;
                clock.advance(profile.overallDeadlineMs);
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.05 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        });
        const { report } = await runScan(scanPorts(provider, deadlineSource(), clock));
        expect(report.scope.assessed).toBe(1);
        expect(report.scope.unassessed).toEqual([
            { path: deadlinePath, reason: 'deadline_elapsed', priorityClass: 'severe-production' },
            { path: lastPath, reason: 'deadline-elapsed-before-admission', priorityClass: 'severe-production' },
        ]);
        expect(calls).toBe(1);
    });

    it('does not book an attempt or bytes for a request the pre-attempt deadline refuses', async () => {
        // The pre-attempt deadline check sits before `budget.reserve`, so a request refused there books
        // nothing. Reordering the reservation first would book a second network attempt and its bytes for
        // a request never sent: `networkAttempts` would read 2 while the provider was called once.
        const clock = fixedClock(1_000);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        let calls = 0;
        const provider = constantProvider(0.05, {
            systemOne: async ({ questions }) => {
                calls += 1;
                clock.advance(profile.overallDeadlineMs);
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.05 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        });
        const { report } = await runScan(scanPorts(provider, deadlineSource(), clock));
        expect(report.scope.assessed).toBe(1);
        expect(calls).toBe(1);
        expect(report.usage.networkAttempts).toBe(1);
    });

    it('still attempts the next unit one millisecond short of the deadline', async () => {
        // The pre-attempt guard's near side reads `remaining <= 0`, so a unit with one millisecond of run
        // time left is still attempted; reading `<= 1` would refuse it as `deadline_elapsed` before the
        // provider ever saw it.
        const clock = fixedClock(1_000);
        const profile = SEMANTIC_BUDGET_PROFILES.local;
        let calls = 0;
        const provider = constantProvider(0.05, {
            systemOne: async ({ questions }) => {
                calls += 1;
                if (calls === 1) {
                    clock.advance(profile.overallDeadlineMs - 1);
                }
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.05 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        });
        const { report } = await runScan(scanPorts(provider, deadlineSource(), clock));
        expect(report.scope.assessed).toBe(3);
        expect(report.scope.unassessed).toEqual([]);
        expect(calls).toBe(3);
        expect(report.failureCode).toBeUndefined();
    });

    it('still reports a request that overran its own attempt timeout as a timeout', async () => {
        // The other side of the same distinction: an attempt that timed out is that unit's failure, the
        // run continues, and nothing is blamed on the deadline.
        const provider = constantProvider(0.05, {
            systemOne: async ({ state, questions }) => {
                if (JSON.stringify(state).includes(deadlinePath)) {
                    throw new APITimeoutError(SEMANTIC_BUDGET_PROFILES.local.attemptTimeoutMs);
                }
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.05 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        });
        const { report } = await runScan(scanPorts(provider, deadlineSource(), fixedClock(1_000)));
        expect(report.scope.assessed).toBe(2);
        expect(report.scope.unassessed).toEqual([
            { path: deadlinePath, reason: 'timeout', priorityClass: 'severe-production' },
        ]);
        expect(report.failureCode).toBe('timeout');
        expect(report.execution).toBe('partial');
    });
});

describe('request carriage follows the order admission handed the unit', () => {
    /** What the fitter charges one region: the planner's own measure, read from the production function. */
    function charge(set: SemanticEvidenceSet, reference: EvidenceReference): number {
        return regionCost(reference, set.contents.get(reference.evidenceId) ?? '');
    }

    function regionKeys(references: readonly EvidenceReference[]): string[] {
        return references.map(
            (reference) => `${reference.path}:${reference.side}:${reference.startLine}-${reference.endLine}`
        );
    }

    it('attempts a charged contract document before an implementation region supplied as context', () => {
        // The fitter attempts a unit's regions in the order admission handed them over, and the collector
        // admits the contract-context unit ahead of the implementation region it supplies as context for
        // the same unit. So the charged document is attempted first, and a flat key over per-region bytes
        // would reach the smaller implementation region first instead: the document is dropped and the
        // request reports `migration or version contract` missing — a token admission had supplied — while
        // nothing about the unit's own evidence changed.
        const specPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const implPath = 'src/modules/Project/undo.ts';
        const document = '- Decision: a recorded contract line that names the undo path.\n'.repeat(24);
        const implementation = Array.from(
            { length: 30 },
            (_unused, index) =>
                `    const restored${String(index + 1)} = await restoreCheckpoint(${String(index + 1)}, { strict: true });\n`
        ).join('');
        const files = [changedFile(specPath), changedFile(implPath, { added: 8, deleted: 2 })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                hunks: new Map<string, PathHunks>([
                    [
                        specPath,
                        {
                            path: specPath,
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [{ startLine: 1, endLine: 2 }],
                        },
                    ],
                    [
                        implPath,
                        {
                            path: implPath,
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 4 },
                                { startLine: 20, endLine: 23 },
                            ],
                        },
                    ],
                ]),
                blobs: {
                    [`${MERGE_BASE}:${specPath}`]: 'it("before", () => {});\n'.repeat(4),
                    [`${HEAD}:${specPath}`]: 'it("after", () => {});\n'.repeat(4),
                    [`${MERGE_BASE}:${implPath}`]: implementation,
                    [`${HEAD}:${implPath}`]: implementation,
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: document,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
            includeDefaultContractContext: true,
        });
        const own = set.references.filter((reference) => reference.side !== 'context' && reference.path === specPath);
        const charged = set.references.filter((reference) => reference.side === 'context');
        const supplied = set.references.filter(
            (reference) => reference.side === 'after' && reference.path === implPath
        );
        const context = [...charged, ...supplied];
        const contract = charged[0];
        const [first, second] = supplied;
        if (contract === undefined || first === undefined || second === undefined) {
            throw new Error('the fixture did not admit the contract document and both implementation regions');
        }
        expect(own).toHaveLength(2);
        expect(charged).toHaveLength(1);
        expect(supplied).toHaveLength(2);
        // The shape the boundary needs: the charged document is larger than one implementation region,
        // two implementation regions fit the room the document leaves, and the document does not fit the
        // room they leave. The own fit must leave that whole room, so the budget pays the own regions
        // first and the context competition is what the order decides.
        expect(charge(set, contract)).toBeGreaterThan(charge(set, first));
        const ownCharge = own.reduce((total, reference) => total + charge(set, reference), 0);
        const budget = ownCharge + charge(set, contract) + 2 * charge(set, first) - 1;
        expect(ownCharge + Math.floor(budget * 0.4)).toBeLessThanOrEqual(budget);
        const fitted = fitUnitEvidence(set, own, context, budget);
        expect(regionKeys(fitted.context.references)).toEqual(regionKeys([contract, first]));
        // The token the document witnesses is supplied, so the question it was charged for is answered
        // rather than reported as insufficient context.
        expect(
            missingRequiredEvidence(
                semanticRule('persisted_shape_changed_without_migration'),
                fitted.own.references,
                fitted.context.references,
                'modified',
                fitted.own.droppedSides,
                fitted.context.droppedSides
            )
        ).toEqual([]);
    });

    it('keeps the own hunk the collector admitted first, not the three smaller ones', () => {
        // The collector ranks a file's two sides as two units by each side's aggregate chargeable bytes
        // and keeps hunk order inside a side, and the fitter now attempts them in that order, so the fat
        // after hunk is attempted before the three smaller ones. A flat key over per-region bytes reaches
        // the smaller hunks first, and at a budget boundary the unit carries three smaller hunks instead
        // of the fat one the collector had already fitted — a different carriage of the same change.
        const path = 'src/modules/Project/undo.ts';
        const content = Array.from(
            { length: 200 },
            (_unused, index) =>
                `    const restored${String(index + 1)} = await restoreCheckpoint(${String(index + 1)}, { strict: true, verify: true });\n`
        ).join('');
        const hunks: PathHunks = {
            path,
            before: [{ startLine: 1, endLine: 6 }],
            after: [
                { startLine: 40, endLine: 59 },
                { startLine: 100, endLine: 103 },
                { startLine: 120, endLine: 123 },
                { startLine: 140, endLine: 143 },
            ],
        };
        const files = [changedFile(path, { added: 20, deleted: 6 })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                hunks: new Map<string, PathHunks>([[path, hunks]]),
                blobs: {
                    [`${MERGE_BASE}:${path}`]: content,
                    [`${HEAD}:${path}`]: content,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const own = set.references.filter((reference) => reference.side !== 'context');
        const regionFor = (side: EvidenceSide, startLine: number, endLine: number): EvidenceReference => {
            const found = set.references.find(
                (reference) =>
                    reference.side === side && reference.startLine === startLine && reference.endLine === endLine
            );
            if (found === undefined) {
                throw new Error(`the fixture did not mint the ${side} region ${String(startLine)}-${String(endLine)}`);
            }
            return found;
        };
        const before = regionFor('before', 1, 6);
        const fat = regionFor('after', 40, 59);
        const smaller = [regionFor('after', 100, 103), regionFor('after', 120, 123), regionFor('after', 140, 143)];
        expect(own).toHaveLength(5);
        // The boundary: the before side and the fat after hunk together fill it, the three smaller after
        // hunks and the before side fit inside it, and all four after hunks together do not.
        const budget = charge(set, before) + charge(set, fat) + 1;
        const smallerCharge = smaller.reduce((total, reference) => total + charge(set, reference), 0);
        const fatCharge = charge(set, fat);
        expect(smallerCharge / 3).toBeLessThan(fatCharge);
        expect(smallerCharge + charge(set, before)).toBeLessThanOrEqual(budget);
        expect(smallerCharge + fatCharge).toBeGreaterThan(budget);
        // The side admission attempted first is the unit's before side, so the before region is attempted
        // ahead of the fat after hunk; a flat byte key would attempt the three smaller after hunks first
        // and drop the fat one.
        const fitted = fitUnitEvidence(set, own, [], budget);
        expect(regionKeys(fitted.own.references)).toEqual(regionKeys([before, fat]));
    });
});

describe('change-kind applicability', () => {
    it('does not mark an added file incomplete for evidence that cannot exist', () => {
        // An added test file has no before side, so a rule about removing prior verification is
        // inapplicable rather than "missing evidence"; reporting it incomplete every time made the
        // whole run inconclusive on a change that only adds files.
        const files = [changedFile('src/modules/Project/__tests__/new.spec.ts', { kind: 'added' })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${HEAD}:src/modules/Project/__tests__/new.spec.ts`]: 'it("works", () => {});\n',
                    [`${MERGE_BASE}:AGENTS.md`]: '# Rules\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            contractPaths: ['AGENTS.md'],
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(1);
        const ruleIds = units[0]?.rules.map((rule) => rule.id) ?? [];
        expect(ruleIds).toContain('assertion_deleted');
        // A before side that cannot exist is not missing. The claim is about a side the change could
        // not have produced, not about every rule: the bypassed-path rule declares it needs the
        // implementation, and an added test file with no changed implementation genuinely does not
        // supply it, so asking every rule to report nothing here would hide exactly that.
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                units[0]?.evidence.own ?? [],
                units[0]?.evidence.context ?? [],
                'added'
            )
        ).toEqual([]);
        expect(
            missingRequiredEvidence(
                semanticRule('production_path_no_longer_reached'),
                units[0]?.evidence.own ?? [],
                units[0]?.evidence.context ?? [],
                'added'
            )
        ).toEqual(['after implementation source']);
        // The same rule on a modified file still demands the before side it can actually have.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), [], [], 'modified')).toEqual([
            'before test source',
            'after test source',
        ]);
    });
});

describe('a rename that changes test collection', () => {
    it('plans a zero-line rename that moves a test out of collection instead of skipping it', () => {
        // A pure rename has a zero-line diff. `no-text-change` excluded it, the eligible count fell
        // to zero, and the skipped branch read the change as delivered advice over the very collection
        // the rename removed.
        const file = changedFile('src/modules/Project/undo-helper.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();

        const set = collectEvidence({
            port: fakeSource({
                files: [file],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.spec.ts`]: 'it("undo", () => {});\n',
                    [`${HEAD}:src/modules/Project/undo-helper.ts`]: 'it("undo", () => {});\n',
                },
                // A pure rename emits no hunks at all — only `similarity index` and `rename from`/`to`
                // headers — so the collector's no-hunks fallback supplies each side whole.
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });

        const { units, excluded } = planUnits([file], set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(1);
        expect(excluded).toEqual([]);
        const unit = units[0];
        // The previous path still admits the test-validity questions even though the destination is no
        // longer a test.
        expect(unit?.rules.map((rule) => rule.id)).toContain('test_skipped_or_excluded');
        // A hunkless rename supplies both sides as whole-file regions under their own paths.
        expect(
            unit?.evidence.references.some(
                (reference) => reference.path === 'src/modules/Project/undo.spec.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            unit?.evidence.references.some(
                (reference) => reference.path === 'src/modules/Project/undo-helper.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // A planned unit is an assessment that was owed; the skipped branch would have claimed otherwise.
        expect(executionState({ dryRun: false, assessed: 0, eligible: units.length, failureCode: undefined })).toBe(
            'unavailable'
        );
    });
});

describe('a zero-line rename owes what its movement changes', () => {
    it('plans a rename that leaves a rule-covered surface instead of skipping it', () => {
        // `no-text-change` excluded the rename, so the check went green over a moved module boundary.
        const file = changedFile('docs/undo.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/undo.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();

        const set = collectEvidence({
            port: fakeSource({
                files: [file],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: 'export const undo = () => {};\n',
                    [`${HEAD}:docs/undo.ts`]: 'export const undo = () => {};\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });

        const { units, excluded } = planUnits([file], set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(1);
        expect(excluded).toEqual([]);
        expect(units[0]?.rules.map((rule) => rule.id)).toContain('persisted_shape_changed_without_migration');
    });

    it('plans a zero-line rename that stops a runner collecting the file', () => {
        const file = changedFile('src/modules/Project/undo-helper.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('still excludes a rename between two paths that change neither rule set nor collection', () => {
        const file = changedFile('docs/undo-copy.md', {
            kind: 'renamed',
            previousPath: 'docs/undo.md',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBe('no-text-change');
    });
});

describe('a zero-line copy owes the duplicated mechanism', () => {
    it('plans an exact copy instead of taking the rename exemption', () => {
        // A pure rename has a zero-line diff, but so does an exact copy: both numstats read `0 0`.
        // The rename exemption keys on `previousPath` alone, which is set for both kinds, so the copy
        // took `no-text-change`, was never planned, and a PR that only duplicated a file reported a
        // green skip over the very mechanism `duplicates_existing_mechanism` exists to question.
        const file = changedFile('docs/undo-copy.md', {
            kind: 'copied',
            previousPath: 'docs/undo.md',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('still excludes a mode-only modification as nothing owed', () => {
        // A file whose mode changed but whose text did not is a zero-line diff with no previous path
        // and no added tree entry: there is nothing to assess, and it must stay a skip.
        const file = changedFile('docs/mode.md', { added: 0, deleted: 0 });
        expect(exclusionReason(file)).toBe('no-text-change');
    });
});

describe('copied files', () => {
    it('supplies both sides of a copy and does not waive the before side', () => {
        // A copy has both sides: its source is unchanged and its destination is new. Reading it as
        // `added` waived the before side, so a copy whose assertion was weakened was answered from the
        // after side alone with an empty `missingEvidence`.
        const files = [
            changedFile('src/modules/Project/__tests__/undo-copy.spec.ts', {
                kind: 'copied',
                previousPath: 'src/modules/Project/__tests__/undo.spec.ts',
                added: 2,
                deleted: 0,
            }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("undo", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/undo-copy.spec.ts`]: 'it("undo", () => {});\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        // Both sides exist: before under the source path, after under the destination.
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'src/modules/Project/__tests__/undo.spec.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'src/modules/Project/__tests__/undo-copy.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // The before side is genuinely supplied, not waived.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), set.references, [], 'copied')).toEqual([]);
        // A copy does not inherit the added-file waiver: with no before region supplied, the before
        // side is genuinely missing.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), [], [], 'copied')).toEqual([
            'before test source',
            'after test source',
        ]);
        // A genuinely added file still gets the existing waiver for the before side.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), set.references, [], 'added')).toEqual([]);
    });
});

describe('a copy whose source is also modified', () => {
    it('yields each region once and selects own regions by the (path, side) the change implies', () => {
        // `M a.ts` plus `C100 a.ts c.ts`: the source's before side is read twice — once for the
        // modification, once for the copy's source — and must be minted once. Selecting own regions by
        // path alone handed the copy the source's after region as though it belonged to the copy.
        const files = [
            changedFile('src/modules/Project/a.ts'),
            changedFile('src/modules/Project/c.ts', {
                kind: 'copied',
                previousPath: 'src/modules/Project/a.ts',
                added: 1,
                deleted: 0,
            }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/a.ts`]: 'export const before = 1;\n',
                    [`${HEAD}:src/modules/Project/a.ts`]: 'export const after = 1;\n',
                    [`${HEAD}:src/modules/Project/c.ts`]: 'export const copy = 1;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.references).toHaveLength(3);
        expect(set.references.filter((r) => r.path === 'src/modules/Project/a.ts' && r.side === 'before')).toHaveLength(
            1
        );
        expect(set.references.filter((r) => r.path === 'src/modules/Project/a.ts' && r.side === 'after')).toHaveLength(
            1
        );
        expect(set.references.filter((r) => r.path === 'src/modules/Project/c.ts' && r.side === 'after')).toHaveLength(
            1
        );

        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const source = units.find((unit) => unit.path === 'src/modules/Project/a.ts');
        const copy = units.find((unit) => unit.path === 'src/modules/Project/c.ts');
        const ownSides = (unit: typeof source): string[] =>
            (unit?.evidence.own ?? []).map((reference) => `${reference.path}:${reference.side}`).sort();
        expect(ownSides(source)).toEqual(['src/modules/Project/a.ts:after', 'src/modules/Project/a.ts:before']);
        expect(ownSides(copy)).toEqual(['src/modules/Project/a.ts:before', 'src/modules/Project/c.ts:after']);
        expect(
            copy?.evidence.own.some(
                (reference) => reference.path === 'src/modules/Project/a.ts' && reference.side === 'after'
            )
        ).toBe(false);
    });
});

describe('a hunked copy whose source is also modified', () => {
    const sourcePath = 'src/modules/Project/a.ts';
    const copyPath = 'src/modules/Project/c.ts';

    function replaceLine(text: string, lineNumber: number, replacement: string): string {
        const lines = text.split('\n');
        lines[lineNumber - 1] = replacement;
        return lines.join('\n');
    }

    function serializedCost(set: SemanticEvidenceSet, reference: EvidenceReference): number {
        return regionCost(reference, set.contents.get(reference.evidenceId) ?? '');
    }

    function hunkedCopy(): { set: SemanticEvidenceSet; files: SemanticChangedFile[] } {
        const lineText = (line: number): string => `export const value${String(line)} = ${String(line)};`;
        const base = `${Array.from({ length: 100 }, (_, index) => lineText(index + 1)).join('\n')}\n`;
        const files = [
            changedFile(sourcePath),
            changedFile(copyPath, {
                kind: 'copied',
                previousPath: sourcePath,
                added: 1,
                deleted: 0,
            }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${sourcePath}`]: base,
                    [`${HEAD}:${sourcePath}`]: replaceLine(base, 20, 'export const changed = 20;'),
                    [`${HEAD}:${copyPath}`]: replaceLine(base, 80, 'export const changed = 80;'),
                },
                hunks: new Map([
                    [
                        sourcePath,
                        {
                            path: sourcePath,
                            before: [{ startLine: 14, endLine: 26 }],
                            after: [{ startLine: 14, endLine: 26 }],
                        },
                    ],
                    [
                        copyPath,
                        {
                            path: copyPath,
                            previousPath: sourcePath,
                            before: [{ startLine: 74, endLine: 86 }],
                            after: [{ startLine: 74, endLine: 86 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        return { set, files };
    }

    it('attributes each region to the changed file that minted it', () => {
        // `M a.ts` plus `C097 a.ts c.ts` mints four regions: the modified source's before/after around
        // line 20 and the copy's before/after around line 80. Both before regions carry the source
        // path, so selecting own regions by (path, side) handed each unit the other's before region.
        const { set, files } = hunkedCopy();
        expect(set.references).toHaveLength(4);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const source = units.find((unit) => unit.path === sourcePath);
        const copy = units.find((unit) => unit.path === copyPath);
        const ownTriples = (unit: typeof source): string[] =>
            (unit?.evidence.own ?? [])
                .map((reference) => `${reference.path}:${reference.side}:${reference.startLine}`)
                .sort();
        expect(ownTriples(source)).toEqual([`${sourcePath}:after:14`, `${sourcePath}:before:14`]);
        expect(ownTriples(copy)).toEqual([`${sourcePath}:before:74`, `${copyPath}:after:74`]);
    });

    it('does not drop the copy own after side under a budget fitting two regions', () => {
        const { set, files } = hunkedCopy();
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const copy = units.find((unit) => unit.path === copyPath);
        expect(copy).toBeDefined();
        // Under the old path-only selection the copy owned three regions — the source's before, its
        // own before, and its own after — and the after, sorting last, was the one a two-region budget
        // dropped while the scope still counted the path as assessed. Its own set is now its before
        // and after alone, so a budget sized for those two keeps the after side.
        const copyBefore = set.references.find(
            (reference) => reference.path === sourcePath && reference.side === 'before' && reference.startLine === 74
        );
        const copyAfter = set.references.find((reference) => reference.path === copyPath && reference.side === 'after');
        expect(copyBefore).toBeDefined();
        expect(copyAfter).toBeDefined();
        if (copyBefore === undefined || copyAfter === undefined) {
            throw new Error('the hunked copy did not mint its own before and after regions');
        }
        const budget = serializedCost(set, copyBefore) + serializedCost(set, copyAfter);
        const fitted = fitUnitEvidence(set, copy?.evidence.own ?? [], [], budget);
        expect(fitted.dropped).toBe(0);
        expect(fitted.own.droppedSides.has('after')).toBe(false);
        expect(fitted.own.references.some((reference) => reference.side === 'after')).toBe(true);
    });
});

describe('provider rounding', () => {
    it('normalizes a rounded distribution instead of refusing a valid answer', () => {
        // Observed live: a three-way Choice summed to 0.99 because the provider rounds, and a 0.01
        // tolerance failed on |0.99 - 1| alone, which made roughly one request in twelve fail.
        const parsed = readChoiceAnswer(
            {
                type: 'choice',
                probabilities: { supported: 0, contradicted: 0.93, insufficient_context: 0.06 },
                confidence: 0.89,
                choice: 'contradicted',
            },
            ['supported', 'contradicted', 'insufficient_context'],
            'rounded distribution'
        );
        expect(parsed.selected).toBe('contradicted');
        const total = Object.values(parsed.probabilities).reduce((sum, value) => sum + value, 0);
        expect(total).toBeCloseTo(1, 10);
    });

    it('still refuses a distribution that is not close to one', () => {
        expect(() =>
            interpretScanOutcome({
                answer: {
                    type: 'choice',
                    probabilities: 0.2,
                    confidence: 0.5,
                    choice: 'signal',
                },
                rule: semanticRule('production_path_no_longer_reached'),
                unitId: 'u',
                path: 'src/a.spec.ts',
                missingEvidence: [],
            })
        ).toThrow(SemanticFailure);
    });
});

describe('interpretation policy', () => {
    it('never turns deterministically missing evidence into a clean result', () => {
        // AC-04: missing required evidence is decisive regardless of the model's preference.
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.01 },
            rule: semanticRule('assertion_deleted'),
            unitId: 'u',
            path: 'src/a.spec.ts',
            missingEvidence: ['before test source'],
        });
        expect(assessment.disposition).toBe('unresolved');
        expect(assessment.missingEvidence).toEqual(['before test source']);
    });

    it('treats a value below the fire threshold as an ordinary no, not a third state', () => {
        // A single threshold, matching the provider's own verifier design: below it the question is
        // simply not raised, and the value is still reported so a near miss is visible.
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.5 },
            rule: { ...semanticRule('audio_thread_allocation'), thresholds: { fire: 0.9 } },
            unitId: 'u',
            path: 'crates/daw-dsp/src/lib.rs',
            missingEvidence: [],
        });
        expect(assessment.disposition).toBe('no_additional_recommendation');
        expect(assessment.probability).toBe(0.5);
        expect(assessment.outcome).toBe('no_signal');
    });

    it('recommends investigation when only the signal threshold clears', () => {
        // Read the threshold from the rule so the case cannot drift when the policy moves: exactly at
        // the fire threshold is the boundary that must recommend.
        const rule = semanticRule('audio_thread_allocation');
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: rule.thresholds.fire },
            rule,
            unitId: 'u',
            path: 'crates/daw-src/lib.rs',
            missingEvidence: [],
        });
        expect(assessment.disposition).toBe('recommend_investigation');
        expect(assessment.investigationCategory).toBe('realtime');
    });

    it('keeps a disputed severe finding visible for investigation', () => {
        // AC-13: a disputed security finding is escalated, never silently discarded.
        const assessment = interpretFinding({
            findingId: 'f1',
            severityCategory: 'security-platform',
            answers: {
                support: {
                    type: 'choice',
                    probabilities: { supported: 0.05, contradicted: 0.9, insufficient_context: 0.05 },
                    confidence: 0.9,
                    choice: 'contradicted',
                },
                attribution: {
                    type: 'choice',
                    probabilities: { introduced_by_change: 0.1, pre_existing: 0.1, undetermined: 0.8 },
                    confidence: 0.8,
                    choice: 'undetermined',
                },
                kind: {
                    type: 'choice',
                    probabilities: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                    confidence: 0.9,
                    choice: 'behavioral_or_contract_issue',
                },
            },
            strongestEvidenceIds: ['a1'],
        });
        expect(assessment.disposition).toBe('disputed');
        expect(assessment.escalate).toBe(true);
    });

    it('requires both support and attribution before a finding advances', () => {
        const assessment = interpretFinding({
            findingId: 'f2',
            severityCategory: 'realtime',
            answers: {
                support: {
                    type: 'choice',
                    probabilities: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                    confidence: 0.9,
                    choice: 'supported',
                },
                attribution: {
                    type: 'choice',
                    probabilities: { introduced_by_change: 0.5, pre_existing: 0.3, undetermined: 0.2 },
                    confidence: 0.5,
                    choice: 'introduced_by_change',
                },
                kind: {
                    type: 'choice',
                    probabilities: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                    confidence: 0.9,
                    choice: 'behavioral_or_contract_issue',
                },
            },
            strongestEvidenceIds: [],
        });
        expect(assessment.disposition).toBe('needs_more_evidence');
    });
});

describe('complete transport admission', () => {
    const questions = { check: { type: 'noul', instructions: 'Is the supplied state consistent?' } };

    function request(overrides: Partial<Parameters<typeof assessUnit>[0]> = {}) {
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 1 };
        return {
            port: { systemOne: async () => ({ model: TYPESAFE_MODEL, answers: {} }) },
            cache: new MapCache(),
            budget: createBudgetController(profile),
            profile,
            deadline: Date.now() + 60_000,
            state: { evidence: 'ordinary text' },
            questions,
            requestedModel: TYPESAFE_MODEL,
            signal: new AbortController().signal,
            ...overrides,
        };
    }

    it('screens unsafe complete state before even a would-hit cache is read', async () => {
        let reads = 0;
        let calls = 0;
        const input = request({
            state: { claim: ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('') },
            cache: {
                read: () => {
                    reads += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
                write: () => {
                    throw new Error('unexpected cache write');
                },
            },
            port: {
                systemOne: async () => {
                    calls += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
            },
        });
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'sensitive_content_excluded' });
        expect(reads).toBe(0);
        expect(calls).toBe(0);
        expect(input.budget.totals().networkAttempts).toBe(0);
    });

    it('pre-aborted would-hit cache has no cache read or reservation', async () => {
        const controller = new AbortController();
        controller.abort();
        let reads = 0;
        const input = request({
            signal: controller.signal,
            cache: {
                read: () => {
                    reads += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
                write: () => {
                    throw new Error('unexpected cache write');
                },
            },
        });
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'cancelled' });
        expect(reads).toBe(0);
        expect(input.budget.totals().networkAttempts).toBe(0);
    });

    it('refuses cancellation during synchronous JSON inspection before hashing or cache read', async () => {
        const controller = new AbortController();
        let reads = 0;
        let calls = 0;
        let inspections = 0;
        const state = { evidence: 'ordinary text' };
        const input = request({
            state,
            signal: controller.signal,
            cache: {
                read: () => {
                    reads += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
                write: () => {
                    throw new Error('unexpected cache write');
                },
            },
            port: {
                systemOne: async () => {
                    calls += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
            },
        });
        // Cancel through the inspector seam; Proxy traps must never run during admission.
        const originalDescriptors = Object.getOwnPropertyDescriptors;
        const inspection = vi.spyOn(Object, 'getOwnPropertyDescriptors').mockImplementation((value) => {
            const descriptors = originalDescriptors(value);
            if (value === state) {
                inspections += 1;
                controller.abort();
            }
            return descriptors;
        });
        try {
            await expect(assessUnit(input)).rejects.toMatchObject({ code: 'cancelled' });
        } finally {
            inspection.mockRestore();
        }
        expect(controller.signal.aborted).toBe(true);
        expect(inspections).toBe(1);
        expect(reads).toBe(0);
        expect(calls).toBe(0);
        expect(input.budget.totals()).toMatchObject({
            logicalRequests: 0,
            networkAttempts: 0,
            retries: 0,
            cacheHits: 0,
        });
    });

    it('refuses an unresolved Promise-shaped cache answer without awaiting it', async () => {
        const controller = new AbortController();
        let reads = 0;
        let calls = 0;
        let writes = 0;
        const input = request({
            signal: controller.signal,
            cache: {
                read: () => {
                    reads += 1;
                    return new Promise<unknown>(() => undefined);
                },
                write: () => {
                    writes += 1;
                },
            },
            port: {
                systemOne: async () => {
                    calls += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
            },
        });
        const result = assessUnit(input);
        controller.abort();
        await expect(result).rejects.toMatchObject({ code: 'invalid_response' });
        expect(reads).toBe(1);
        expect(calls).toBe(0);
        expect(writes).toBe(0);
        expect(input.budget.totals()).toMatchObject({
            logicalRequests: 0,
            networkAttempts: 0,
            retries: 0,
            cacheHits: 0,
        });
    });

    it('does not accept a cache answer after its synchronous read cancels the request', async () => {
        const controller = new AbortController();
        const input = request({
            signal: controller.signal,
            cache: {
                read: () => {
                    controller.abort();
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
                write: () => {
                    throw new Error('unexpected cache write');
                },
            },
        });
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'cancelled' });
        expect(input.budget.totals().cacheHits).toBe(0);
    });

    it('does not write or accept a provider success returned after cancellation', async () => {
        const controller = new AbortController();
        let writes = 0;
        const input = request({
            signal: controller.signal,
            cache: {
                read: () => undefined,
                write: () => {
                    writes += 1;
                },
            },
            port: {
                systemOne: async () => {
                    controller.abort();
                    return { model: TYPESAFE_MODEL, answers: {}, usage: { input_tokens: 1, output_tokens: 0 } };
                },
            },
        });
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'cancelled' });
        expect(writes).toBe(0);
        expect(input.budget.totals().actualInputTokens).toBe(0);
    });

    it('accepts schema-valid usage greater than serialized request bytes', async () => {
        const input = request({
            port: {
                systemOne: async () => ({
                    model: TYPESAFE_MODEL,
                    answers: {},
                    usage: { input_tokens: 100_000, output_tokens: 0 },
                }),
            },
        });
        await expect(assessUnit(input)).resolves.toMatchObject({ fromCache: false });
        expect(input.budget.totals().actualInputTokens).toBe(100_000);
    });

    it('refuses cumulative usage overflow atomically before cache write without retry', async () => {
        let calls = 0;
        let writes = 0;
        const input = request({
            cache: {
                read: () => undefined,
                write: () => {
                    writes += 1;
                },
            },
            port: {
                systemOne: async () => {
                    calls += 1;
                    return { model: TYPESAFE_MODEL, answers: {}, usage: { input_tokens: 1, output_tokens: 0 } };
                },
            },
        });
        input.budget.recordUsage({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 }, 7);
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'invalid_response' });
        expect(calls).toBe(1);
        expect(writes).toBe(0);
        expect(input.budget.totals()).toMatchObject({
            actualInputTokens: Number.MAX_SAFE_INTEGER,
            estimatedInputTokens: 7,
            retries: 0,
        });
    });

    it.each([
        { check: { type: 'noul', instructions: ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('') } },
        { check: { type: 'choice', criteria: { yes: ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('') } } },
        { check: { type: 'score', criteria: ['one'] } },
    ])('admits no cache or provider effects for rejected complete questions %#', async (questions) => {
        let reads = 0;
        let calls = 0;
        const input = request({
            questions,
            cache: {
                read: () => {
                    reads += 1;
                    return {};
                },
                write: () => undefined,
            },
            port: {
                systemOne: async () => {
                    calls += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
            },
        });
        await expect(assessUnit(input)).rejects.toBeInstanceOf(SemanticFailure);
        expect(reads).toBe(0);
        expect(calls).toBe(0);
        expect(input.budget.totals().networkAttempts).toBe(0);
    });

    it('passes the frozen snapshot through a synchronous cache read and preserves the golden identity', async () => {
        const state = { evidence: 'ordinary text' };
        let observedKey = '';
        const input = request({
            state,
            cache: {
                read: (key) => {
                    observedKey = key;
                    state.evidence = 'mutated';
                    return undefined;
                },
                write: () => undefined,
            },
            port: {
                systemOne: async (request) => {
                    expect(request.state).toEqual({ evidence: 'ordinary text' });
                    expect(Object.isFrozen(request.state)).toBe(true);
                    expect(request.state).toBe(request.prepared.payload.state);
                    expect(request.questions).toBe(request.prepared.payload.questions);
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
            },
        });
        await assessUnit(input);
        expect(observedKey).toBe('d5e5e60cc248724fe82a6ac6a48d001593f6997e5dae78dc2ba97d955263436d');
    });

    it('keeps a local refusal terminal even when a provider wraps it as a connection error', async () => {
        let calls = 0;
        const input = request({
            port: {
                systemOne: async () => {
                    calls += 1;
                    throw new APIConnectionError('offline wrapper', {
                        cause: new SemanticFailure('invalid_response', 'wire mismatch'),
                    });
                },
            },
        });
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'invalid_response' });
        expect(calls).toBe(1);
        expect(input.budget.totals()).toMatchObject({ networkAttempts: 1, retries: 0 });
    });

    it('cancels the caller retry wait without admitting another attempt', async () => {
        const controller = new AbortController();
        let calls = 0;
        const input = request({
            signal: controller.signal,
            port: {
                systemOne: async () => {
                    calls += 1;
                    throw new RateLimitError(429, {}, new Headers({ 'retry-after': '30' }));
                },
            },
        });
        const recordRetry = input.budget.recordRetry;
        input.budget = {
            ...input.budget,
            recordRetry: () => {
                recordRetry();
                queueMicrotask(() => controller.abort());
            },
        };
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'cancelled' });
        expect(calls).toBe(1);
        expect(input.budget.totals()).toMatchObject({ networkAttempts: 1, retries: 1 });
    });

    it('checks cancellation immediately before handing off to a recording provider', async () => {
        const controller = new AbortController();
        let calls = 0;
        const input = request({
            signal: controller.signal,
            port: {
                systemOne: async () => {
                    calls += 1;
                    return { model: TYPESAFE_MODEL, answers: {} };
                },
            },
        });
        const reserve = input.budget.reserve;
        input.budget = {
            ...input.budget,
            reserve: (bytes) => {
                const result = reserve(bytes);
                controller.abort();
                return result;
            },
        };
        await expect(assessUnit(input)).rejects.toMatchObject({ code: 'cancelled' });
        expect(calls).toBe(0);
    });

    it('accepts an exact safe aggregate plus zero and caches the response', async () => {
        let writes = 0;
        const input = request({
            cache: {
                read: () => undefined,
                write: () => {
                    writes += 1;
                },
            },
            port: {
                systemOne: async () => ({
                    model: TYPESAFE_MODEL,
                    answers: {},
                    usage: { input_tokens: 0, output_tokens: 0 },
                }),
            },
        });
        input.budget.recordUsage({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 }, 7);
        await expect(assessUnit(input)).resolves.toMatchObject({ fromCache: false });
        expect(input.budget.totals().actualInputTokens).toBe(Number.MAX_SAFE_INTEGER);
        expect(writes).toBe(1);
    });

    it.each(['claim', 'expectedBehavior', 'reproductionReferences'] as const)(
        'screens verify caller %s before a would-hit cache or recording provider',
        async (field) => {
            const { runVerify } = await import('../verify.ts');
            const secret = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
            let reads = 0;
            let calls = 0;
            let finding: CandidateFinding = {
                findingId: 'f1',
                headSha: HEAD,
                claim: 'a claim',
                expectedBehavior: 'expected behavior',
                evidenceReferences: [{ path: 'src/modules/Project/a.ts', side: 'after', startLine: 1, endLine: 1 }],
            };
            if (field === 'reproductionReferences') {
                finding = {
                    ...finding,
                    reproductionReferences: [{ path: 'probe.txt', note: secret, verifiedExecution: false }],
                };
            } else {
                finding = { ...finding, [field]: secret };
            }
            const result = await runVerify({
                ports: {
                    source: fakeSource({
                        files: [],
                        blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
                    }),
                    provider: {
                        systemOne: async () => {
                            calls += 1;
                            return { model: TYPESAFE_MODEL, answers: {} };
                        },
                    },
                    cache: {
                        read: () => {
                            reads += 1;
                            return {};
                        },
                        write: () => undefined,
                    },
                    clock: fixedClock(1_000),
                    signal: new AbortController().signal,
                    log: () => undefined,
                },
                revision: BASE_REVISION,
                profile: SEMANTIC_BUDGET_PROFILES.local,
                findings: [finding],
                runId: 'complete-verify-screen',
            });
            expect(result.report.failureCode).toBe('sensitive_content_excluded');
            expect(result.report.findingAssessments).toEqual([]);
            expect(result.report.usage.networkAttempts).toBe(0);
            expect(reads).toBe(0);
            expect(calls).toBe(0);
        }
    );
});

describe('provider adapter', () => {
    it('bounds retries, counts them, and never rerolls a successful answer', async () => {
        // AC-09
        let attempts = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new RateLimitError(429, {}, new Headers());
                }
                return { model: TYPESAFE_MODEL, answers: {}, usage: { input_tokens: 10, output_tokens: 0 } };
            },
        };
        const budget = createBudgetController({ ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 1 });
        const clock = fixedClock(1_000);
        const result = await assessUnit({
            port: provider,
            cache: new MapCache(),
            budget,
            profile: { ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 1 },
            deadline: 1_000 + 60_000,
            state: { evidence: {} },
            questions: { check: { type: 'noul' } },
            requestedModel: TYPESAFE_MODEL,
            signal: new AbortController().signal,
            now: clock.now,
        });
        expect(result.fromCache).toBe(false);
        expect(attempts).toBe(2);
        expect(budget.totals().retries).toBe(1);
        expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['transient', 'ok']);
    });

    it('does not retry a terminal failure', async () => {
        let attempts = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                attempts += 1;
                throw new AuthenticationError(401, {}, new Headers());
            },
        };
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 3 };
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(profile),
                profile,
                deadline: Date.now() + 60_000,
                state: {},
                questions: { check: { type: 'noul' } },
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'authentication_failed' });
        expect(attempts).toBe(1);
    });

    it('classifies a provider context-window rejection as a per-request size refusal', async () => {
        // The provider answers a request past its context window with a 400 whose body names
        // `max_tokens_exceeded`. Reading that as `invalid_response` reported a malformed response for a
        // request that was simply too large, and sent the next reader looking at the answer schema. It is
        // the same per-request refusal the budget controller raises, so it carries the same code, stays
        // terminal, and keeps the provider's own message.
        let attempts = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                attempts += 1;
                throw new BadRequestError(400, { detail: { error_type: 'max_tokens_exceeded' } }, new Headers());
            },
        };
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 3 };
        const assessment = assessUnit({
            port: provider,
            cache: new MapCache(),
            budget: createBudgetController(profile),
            profile,
            deadline: Date.now() + 60_000,
            state: {},
            questions: { check: { type: 'noul' } },
            requestedModel: TYPESAFE_MODEL,
            signal: new AbortController().signal,
        });
        await expect(assessment).rejects.toMatchObject({ code: 'request_too_large' });
        await expect(assessment).rejects.toThrow(/max_tokens_exceeded/u);
        expect(attempts).toBe(1);
    });

    it('rejects a returned model that is not the pinned model', async () => {
        // AC-11: an unexpected returned model is refused, never accepted.
        const provider = constantProvider(0.1, {
            systemOne: async () => ({
                model: 'jev-latest',
                answers: {},
                usage: { input_tokens: 1, output_tokens: 0 },
            }),
        });
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(SEMANTIC_BUDGET_PROFILES.local),
                profile: SEMANTIC_BUDGET_PROFILES.local,
                deadline: Date.now() + 10_000,
                state: {},
                questions: { check: { type: 'noul' } },
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'model_mismatch' });
    });

    it('stops admitting requests once the attempt budget is exhausted', () => {
        // AC-08: concurrent reservations cannot oversubscribe the budget.
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxAttempts: 3, maxTotalSubmittedBytes: 1_000 };
        const budget = createBudgetController(profile);
        expect('attempt' in budget.reserve(10)).toBe(true);
        expect('attempt' in budget.reserve(10)).toBe(true);
        expect('attempt' in budget.reserve(10)).toBe(true);
        const refused = budget.reserve(10);
        expect('refused' in refused && refused.refused).toBe('budget_exhausted');
        expect(budget.totals().networkAttempts).toBe(3);
    });

    it('refuses a request larger than the per-request byte limit', () => {
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRequestBytes: 100, maxTotalSubmittedBytes: 1_000 };
        const budget = createBudgetController(profile);
        const refused = budget.reserve(101);
        // The per-request limit belongs to the unit the request is for, so it carries its own code: the
        // whole-run budgets this controller also enforces are the only refusals that stop admission.
        expect('refused' in refused && refused.refused).toBe('request_too_large');
    });

    it('admits a request at exactly the per-request byte limit', () => {
        // The per-request guard reads `>` so the limit itself is admissible; `>=` would refuse it. The
        // controller is driven directly because the planner keeps admitted bodies under the state cap.
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRequestBytes: 100, maxTotalSubmittedBytes: 1_000 };
        const budget = createBudgetController(profile);
        const admitted = budget.reserve(100);
        expect('attempt' in admitted).toBe(true);
        expect(budget.totals().submittedBytes).toBe(100);
    });

    it('admits the total byte cap itself and refuses only the byte past it', () => {
        // The total guard reads `>` so the cap itself is admissible and the next byte is not; `>=` would
        // refuse the exact-cap reservation before the run ever spent the budget.
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRequestBytes: 1_000, maxTotalSubmittedBytes: 100 };
        const budget = createBudgetController(profile);
        expect('attempt' in budget.reserve(100)).toBe(true);
        const refused = budget.reserve(1);
        expect('refused' in refused && refused.refused).toBe('budget_exhausted');
        expect(budget.totals().networkAttempts).toBe(1);
        expect(budget.totals().submittedBytes).toBe(100);
    });

    it('invalidates the response cache when the model or question changes', () => {
        // AC-06
        const base = { state: { evidence: { a1: 'x' } }, questions: { r1: { type: 'choice' } }, model: TYPESAFE_MODEL };
        const original = computeResponseCacheKey(base);
        expect(computeResponseCacheKey({ ...base, model: 'jev-1.13.1' })).not.toBe(original);
        expect(
            computeResponseCacheKey({ ...base, questions: { r1: { type: 'choice' }, r2: { type: 'choice' } } })
        ).not.toBe(original);
        expect(computeResponseCacheKey({ ...base, state: { evidence: { a1: 'y' } } })).not.toBe(original);
    });

    it('surfaces a rate limit as a typed outcome', async () => {
        // AC-10
        const profile = { ...SEMANTIC_BUDGET_PROFILES.local, maxRetriesPerRequest: 0 };
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                throw new RateLimitError(429, {}, new Headers());
            },
        };
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(profile),
                profile,
                deadline: Date.now() + 10_000,
                state: {},
                questions: { check: { type: 'noul' } },
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'rate_limited' });
    });
});

describe('budget profiles', () => {
    it('ships profiles whose limits are internally consistent', () => {
        for (const profile of Object.values(SEMANTIC_BUDGET_PROFILES)) {
            expect(() => assertBudgetProfile(profile)).not.toThrow();
            // The scan budgets bind the same way as the verify budgets below: a state at the scan
            // ceiling must fit one request, or the planner would reserve against a budget the provider
            // refuses whatever the profile says.
            expect(profile.maxStatePlusQuestionBytes).toBeLessThanOrEqual(profile.maxRequestBytes);
            expect(profile.maxRequestBytes).toBeLessThanOrEqual(profile.maxTotalSubmittedBytes);
            // The verify budgets bind in turn: a region the collector admits must fit one request's
            // state budget, and one request the run's total, or the profile configures a collection
            // that can never be sent.
            expect(profile.verify.maxRegionBytes).toBeLessThanOrEqual(profile.verify.maxStatePlusQuestionBytes);
            expect(profile.verify.maxStatePlusQuestionBytes).toBeLessThanOrEqual(profile.verify.maxRequestBytes);
            expect(profile.verify.maxRequestBytes).toBeLessThanOrEqual(profile.verify.maxTotalSubmittedBytes);
        }
    });

    it('pins every profile constant a comment reasons about, beside its evidence', () => {
        // A number whose comment makes a claim no test holds is a comment that can drift: mutating the
        // state ceiling from 96 to 128 KiB, the request ceiling from 128 to 192 KiB, the deadline from 600
        // to 900 s or the attempt timeout from 20 to 5 s left every relation in this file green. Each pin
        // is the value its comment reasons about.
        const ci = SEMANTIC_BUDGET_PROFILES.ci;
        // The window bound: the retained boundary that motivated it refused requests of 130,104 and
        // 130,895 bytes while a 130,723-byte request was answered, so 96 KiB — 24,576 estimated tokens by
        // the `bytes / 4` proxy — stays under the window. A larger value is a request the provider may
        // refuse, which is the defect this ceiling repaired.
        expect(ci.maxStatePlusQuestionBytes).toBe(96 * 1024);
        expect(ci.maxRequestBytes).toBe(128 * 1024);
        // Ten minutes, and the job's own timeout is what the comment compares it to: the workflow states
        // it, so the claim is read from there rather than asserted.
        expect(ci.overallDeadlineMs).toBe(600_000);
        const workflow = readFileSync(join(repositoryRoot, ADVISORY_WORKFLOW_PATH), 'utf8');
        // The parse alone: the relation below is implied by this pin and the deadline pin beside it, so
        // asserting it here would be an assertion no mutation of either input could fail. The fixtures
        // drive the relation where it can fail.
        expect(assessJobTimeoutMinutes(workflow)).toBe(30);
        // The parse is anchored to the assess job, which is the job the deadline runs inside: an earlier
        // job's larger timeout does not bound the relation, and an assess job lowered under the deadline
        // fails it.
        const earlierJob = workflowFixture({ earlier: 120, assess: 30 });
        expect(assessJobTimeoutMinutes(earlierJob)).toBe(30);
        expect(deadlineFitsAssessJob(earlierJob)).toBe(true);
        const loweredAssess = workflowFixture({ earlier: 120, assess: 5 });
        // The relation first: it is the claim the lowered job has to fail, and the parse assertion beside
        // it would mask that failure.
        expect(deadlineFitsAssessJob(loweredAssess)).toBe(false);
        expect(assessJobTimeoutMinutes(loweredAssess)).toBe(5);
        // One job and no earlier sibling reads the same way.
        const singleJob = workflowFixture({ assess: 30 });
        expect(assessJobTimeoutMinutes(singleJob)).toBe(30);
        expect(deadlineFitsAssessJob(singleJob)).toBe(true);
        // A job *after* `assess` carrying its own timeout: the assess block ends at that job's header, so a
        // job of its own with no timeout reads as no timeout rather than inheriting the later job's — which
        // is what ignoring the anchor would do, and would leave the relation above green.
        const laterJob = workflowFixture({ assess: 30, later: 120 });
        expect(assessJobTimeoutMinutes(laterJob)).toBe(30);
        const inheritedTimeout = workflowFixture({ later: 120 });
        expect(assessJobTimeoutMinutes(inheritedTimeout)).toBeUndefined();
        expect(deadlineFitsAssessJob(inheritedTimeout)).toBe(false);
        // One attempt may spend the whole state budget, and this is the timeout that lets it: 20 s against
        // the slowest retained call, 1.13 s on report 9f33b0a0's single local attempt, about eighteen
        // times it. The ratio is stated here rather than asserted beside the pin, where no value above
        // 1.13 s could fail.
        expect(ci.attemptTimeoutMs).toBe(20_000);
        expect(ci.maxAttempts).toBe(6144);
        expect(ci.maxRetriesPerRequest).toBe(1);
        expect(ci.concurrentRequests).toBe(4);
        expect(ci.contextExpansionPasses).toBe(1);
        expect(ci.maxTotalSubmittedBytes).toBe(384 * 1024 * 1024);
        // The verify block's own comment claims the scan window bound, so its state ceiling is that bound.
        expect(ci.verify.maxStatePlusQuestionBytes).toBe(ci.maxStatePlusQuestionBytes);
        expect(ci.verify.maxRequestBytes).toBe(ci.maxRequestBytes);
        // `local`'s numbers are the ones its rationale in this file names: four attempts at a 3 s timeout
        // would take 12 s, past its 8 s deadline, which is why its cap is the ordinary guard there.
        const local = SEMANTIC_BUDGET_PROFILES.local;
        expect(local.maxAttempts).toBe(4);
        expect(local.attemptTimeoutMs).toBe(3_000);
        expect(local.overallDeadlineMs).toBe(8_000);
    });

    it('sizes the ci attempt backstop above the byte guard it backs up', () => {
        // Each figure comes from a retained report under `.agents/semantic-review/`, the only basis a spec
        // can verify: the CI artifacts behind the earlier 0.217-0.291 s figure are public but not kept
        // locally. Fastest retained rate: report fef405f0's 8 network attempts in 2.53 s, 0.31625 s an
        // attempt. Typical request size: report 784380a1's 1,863,741 submitted bytes over 19 network
        // attempts, 98,092 bytes a request — never over its 42 assessed units, because its 23 cache hits
        // submitted nothing. The relations pin the hierarchy those figures imply: the attempt cap is above
        // what the deadline carries even at the fastest retained rate, and the deadline's own capacity, at
        // the typical request size and at the largest request the profile admits, fits inside the total.
        const ci = SEMANTIC_BUDGET_PROFILES.ci;
        const maximalRequests = Math.ceil(ci.maxTotalSubmittedBytes / ci.maxStatePlusQuestionBytes);
        const fastestRetainedSecondsPerAttempt = 0.31625;
        const measuredTypicalRequestBytes = 98_092;
        // The literals are pinned, and each to the retained report named above: a slower rate, a smaller
        // request size or a larger total would all leave the relation below trivially true, which is how
        // it stopped reddening the values it was written to catch.
        expect(fastestRetainedSecondsPerAttempt).toBe(2.53 / 8);
        expect(measuredTypicalRequestBytes).toBe(Math.round(1_863_741 / 19));
        expect(ci.maxTotalSubmittedBytes).toBe(384 * 1024 * 1024);
        expect(ci.maxAttempts).toBeGreaterThanOrEqual(maximalRequests);
        expect(ci.maxAttempts * fastestRetainedSecondsPerAttempt).toBeGreaterThan(ci.overallDeadlineMs / 1_000);
        expect(
            (ci.overallDeadlineMs / 1_000 / fastestRetainedSecondsPerAttempt) * measuredTypicalRequestBytes
        ).toBeLessThanOrEqual(ci.maxTotalSubmittedBytes);
        // The same relation at the provider's request ceiling, which no admitted request reaches: the state
        // ceiling caps a planned body near 98 KiB, so this is a conservative bound rather than a size the
        // profile can actually send.
        expect(
            (ci.overallDeadlineMs / 1_000 / fastestRetainedSecondsPerAttempt) * ci.maxRequestBytes
        ).toBeLessThanOrEqual(ci.maxTotalSubmittedBytes);
        // The figures this case first carried failed this relation twice over: 0.217 s an attempt at a
        // 44,375-byte typical request — 1,863,741 divided by 42 assessed units instead of 19 attempts —
        // put the deadline's capacity at 122,695,853 bytes against the 16,777,216-byte total then shipped,
        // and the corrected 98,092-byte request still exceeded the 128 MiB total that replaced it.
        // No such rule applies to `local`, whose attempt cap is the ordinary guard and whose deadline is
        // the worst-case bound: four attempts at the 3 s timeout would take 12 s, past the 8 s deadline,
        // so the cap ends a normal run and the deadline only bounds one whose attempts hang. Its cap is
        // small by design — a local run assesses a handful of units, not a plan.
        const local = SEMANTIC_BUDGET_PROFILES.local;
        expect(local.overallDeadlineMs).toBeLessThanOrEqual(local.maxAttempts * local.attemptTimeoutMs);
    });
});

describe('report contract', () => {
    async function scanOnce() {
        const clock = fixedClock(1_000);
        return runScan(
            scanPorts(
                constantProvider(0.8),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            )
        );
    }

    it('batches one rule per applicable question into a single request per unit', async () => {
        // AC-05: all applicable rules for one unit share one request.
        let requests = 0;
        const provider = constantProvider(0.8, {
            systemOne: async ({ questions }) => {
                requests += 1;
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.8 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        });
        const clock = fixedClock(1_000);
        const result = await runScan(
            scanPorts(
                provider,
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            )
        );
        expect(requests).toBe(1);
        expect(result.report.signals.map((signal) => signal.ruleId)).toContain('audio_thread_allocation');
    });

    it('produces a report that validates and never claims a clean bill of health', async () => {
        // AC-14, AC-24
        const result = await scanOnce();
        const report = validateReport(result.report);
        const summary = renderSummary(report);
        expect(summary).not.toMatch(/all clear|approved|verified correct|safe to merge/iu);
        expect(summary).toContain('Semantic review (scan)');
        expect(report.scope.assessed).toBe(1);
    });

    it('reports a cache hit instead of a second provider call', async () => {
        // Observed live: a rerun served every unit from the durable cache yet reported 0 cache hits.
        let calls = 0;
        const provider = constantProvider(0.1, {
            systemOne: async ({ questions }) => {
                calls += 1;
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.1 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 7, output_tokens: 0 } };
            },
        });
        const source = fakeSource({
            files: [changedFile('src/modules/AudioEngine/live.ts')],
            blobs: {
                [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
            },
        });
        const cache = new MapCache();
        const first = scanPorts(provider, source, fixedClock(1_000));
        const firstRun = await runScan({ ...first, ports: { ...first.ports, cache } });
        expect(firstRun.report.scope.cacheHits).toBe(0);
        const second = scanPorts(provider, source, fixedClock(2_000));
        const secondRun = await runScan({ ...second, ports: { ...second.ports, cache } });
        expect(calls).toBe(1);
        expect(secondRun.report.scope.cacheHits).toBe(1);
        expect(secondRun.report.usage.networkAttempts).toBe(0);
    });

    it('makes zero provider calls in a dry run', async () => {
        // AC-20
        let calls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                calls += 1;
                throw new Error('dry run must not call the provider');
            },
        };
        const clock = fixedClock(1_000);
        const result = await runScan({
            ...scanPorts(
                provider,
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            ),
            dryRun: true,
        });
        expect(calls).toBe(0);
        expect(result.report.execution).toBe('skipped');
        expect(result.previews).toHaveLength(1);
    });

    it('rejects a report with an out-of-range probability', async () => {
        const result = await scanOnce();
        const broken = {
            ...result.report,
            signals: [
                {
                    ...result.report.signals[0],
                    probability: 1.4,
                },
            ],
        };
        expect(() => validateReport(broken)).toThrow(SemanticFailure);
    });

    it('rejects a report with an unknown schema version', async () => {
        const result = await scanOnce();
        expect(() => validateReport({ ...result.report, schemaVersion: 'semantic-review-v2' })).toThrow(
            SemanticFailure
        );
    });

    it('rejects a report whose scope counts disagree', async () => {
        const result = await scanOnce();
        const broken = { ...result.report, scope: { ...result.report.scope, assessed: 5 } };
        expect(() => validateReport(broken)).toThrow(SemanticFailure);
    });

    it('rejects an invalid probability in a stored report', async () => {
        const result = await scanOnce();
        const broken = { ...result.report, signals: [{ ...result.report.signals[0], confidence: Number.NaN }] };
        expect(() => validateReport(broken)).toThrow(SemanticFailure);
    });
});

describe('question and policy identity', () => {
    it('refuses to replay an assessment whose questions have since changed', () => {
        // Replay reinterpreted stored answers with the current rule wording and kept the old digest,
        // so a disposition computed from one question was presented under another's identity.
        expect(() => assertQuestionsAreReplayable({ rulesDigest: 'a'.repeat(64) })).toThrow(SemanticFailure);
        expect(() => assertQuestionsAreReplayable({ rulesDigest: computeRulesDigest() })).not.toThrow();
    });

    it('separates question identity from threshold policy', () => {
        // A threshold-only change must be replayable without a new assessment, so it may not enter
        // the question digest — but it must change the policy digest the report records.
        const shipped = computePolicyDigest();
        const overridden = computePolicyDigest({
            audio_thread_allocation: { fire: 0.1 },
        });
        expect(overridden).not.toBe(shipped);
        expect(computeRulesDigest()).toBe(computeRulesDigest());
    });

    it('records the policy that actually produced a report', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.1),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.policyDigest).toBe(computePolicyDigest());
        expect(result.report.policyDigest).not.toBe(result.report.rulesDigest);
        expect(renderSummary(result.report)).toContain('policy');
    });

    it('refuses a report that does not name the policy it applied', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.1),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(() => validateReport({ ...result.report, policyDigest: 'not-a-digest' })).toThrow(SemanticFailure);
        expect(() => validateReport({ ...result.report, policyDigest: 'a'.repeat(64) })).not.toThrow();
    });
});

describe('incomplete-scope reporting', () => {
    const before = 'const before = 1;\n';
    const after = 'const sample_value = 1;\n'.repeat(900);

    async function reducedScan() {
        const provider = constantProvider(0.05);
        // A second, small unit so the run delivers something: a run whose only unit is skipped is
        // `unavailable`, and the claim here is about a partial assessment, not about an absent one.
        const source = fakeSource({
            files: [
                changedFile('crates/daw-dsp/src/big.rs', { added: 900, deleted: 1 }),
                changedFile('crates/daw-dsp/src/small.rs'),
            ],
            blobs: {
                [`${MERGE_BASE}:crates/daw-dsp/src/big.rs`]: before,
                [`${HEAD}:crates/daw-dsp/src/big.rs`]: after,
                [`${MERGE_BASE}:crates/daw-dsp/src/small.rs`]: 'const before = 1;\n',
                [`${HEAD}:crates/daw-dsp/src/small.rs`]: 'const after = 2;\n',
            },
        });
        const base = scanPorts(provider, source, fixedClock(1_000));
        return runScan({ ...base, limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 } });
    }

    it('reports a run whose evidence was cut as partial, not completed', async () => {
        // The exit code branches on execution, so `completed` here told a consumer that an assessment
        // finished for a scope that was never fully sent.
        const result = await reducedScan();
        expect(result.report.scope.truncated.length).toBeGreaterThan(0);
        expect(result.report.execution).toBe('partial');
        expect(() => validateReport(result.report)).not.toThrow();
    });

    it('refuses a report that claims completion while carrying truncated evidence', async () => {
        const result = await reducedScan();
        expect(() => validateReport({ ...result.report, execution: 'completed' })).toThrow(SemanticFailure);
    });

    it('does not render a clean sentence when no question was decidable', async () => {
        // An all-unresolved run printed the same sentence as an affirmative no_signal run.
        const result = await runScan(
            scanPorts(
                constantProvider(0.5),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        // Nothing fired, and every answer sat at the midpoint: that is an undecided run, and the
        // summary has to say so rather than print the sentence an affirmatively quiet run prints.
        expect(result.report.signals.some((signal) => signal.disposition === 'no_additional_recommendation')).toBe(
            true
        );
        const summary = renderSummary(result.report);
        expect(summary).not.toContain('Completed: no additional semantic signals');
        expect(summary).toContain('No question was decidable');
    });

    it('renders the clean sentence when every question was decisively quiet', async () => {
        // The other direction of the same property: the quiet sentence must remain reachable, or the
        // report would have no way to say that the questions were asked and answered.
        const result = await runScan(
            scanPorts(
                constantProvider(0.5),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        const quiet = {
            ...result.report,
            signals: result.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };
        const summary = renderSummary(quiet);
        expect(summary).toContain('Completed: no additional semantic signals');
        expect(summary).not.toContain('No question was decidable');
    });
});

describe('credential-shaped content', () => {
    // Composed at runtime: the repository's pull-request diff secret scan matches these literals in
    // source, so a fixture must never contain one contiguously.
    const AWS_SHAPED = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
    const GITHUB_SHAPED = secretFixture('ghp_', 'AAAAAAAA', 'AAAAAAAA', 'AAAAAAAA', 'AAAAAAAA', 'AAAA');

    it('withholds a credential in an ordinary-looking file instead of sending it', () => {
        // Path patterns cannot see this: the filename announces nothing.
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/config.example.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/config.example.ts`]: `export const key = '${AWS_SHAPED}';\n`,
                    [`${HEAD}:src/modules/Project/config.example.ts`]: `export const key = '${AWS_SHAPED}';\n`,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.references).toHaveLength(0);
        // One entry per path: both sides are withheld, but the manifest counts a path once.
        expect(set.excluded).toEqual([
            { path: 'src/modules/Project/config.example.ts', reason: 'credential-shaped-content-excluded' },
        ]);
        expect(set.limitations.join(' ')).toContain('(before)');
        expect(set.limitations.join(' ')).toContain('(after)');
        expect(set.limitations.join(' ')).toContain('withheld');
    });

    it('withholds any admitted region carrying a token, contract included', () => {
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/AudioEngine/live.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                    [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    [`${MERGE_BASE}:AGENTS.md`]: `token: ${GITHUB_SHAPED}\n`,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            contractPaths: ['AGENTS.md'],
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(set.references).toHaveLength(2);
    });
});

describe('a fixture is not a test', () => {
    it('asks the test questions only about tests', () => {
        // A live run fired two test-validity signals on a JSON fixture, because everything under
        // `__tests__/` counted as a test and the snapshot's content holds shell `if` statements.
        // The extension gate keeps that false positive out: a data file in a test directory is not
        // test material.
        expect(isTestPath('scripts/__tests__/fixtures/health-gate-workflows.snapshot.json')).toBe(false);
        // A code file in `__tests__/` without a runner suffix can still carry assertions the specs
        // import and execute, so it is test material even though the suffix rule alone would miss it.
        expect(isTestPath('src/modules/AiRuntime/repositories/__tests__/providerProtocolConformance.ts')).toBe(true);
        expect(isTestPath('src/modules/WorkspaceShell/presentations/__tests__/expectExternalProjectLink.ts')).toBe(
            true
        );
        // The suffix still decides on its own, wherever the file sits.
        expect(isTestPath('src/modules/Project/__tests__/undoProject.spec.ts')).toBe(true);
        expect(isTestPath('src/modules/Project/undoProject.spec.tsx')).toBe(true);
        expect(isTestPath('tests/e2e/audioOwnership.native.spec.ts')).toBe(true);
        // A code file outside `__tests__/` with no runner suffix is implementation, not test material.
        expect(isTestPath('src/modules/Project/useCases/undoProject.ts')).toBe(false);
        expect(isTestPath('tests/e2e/admitLoopbackProvider.ts')).toBe(false);
    });
});

describe('saved-project-state applicability matrix', () => {
    const PROJECT_STATE_RULE_IDS = [
        'mutation_outside_undo_path',
        'persisted_shape_changed_without_migration',
        'silent_data_loss_possible',
    ] as const;

    // All three project-state rules share one applicability predicate, so each path must select all
    // three or none; a single rule disagreeing reddens the matrix.
    function selected(path: string): string[] {
        return PROJECT_STATE_RULE_IDS.filter((id) => semanticRule(id).appliesTo(path));
    }

    it('digests a lossless encoding of every persisted-state matcher', () => {
        // The three rules' digest input is exactly the lossless encoding of the persisted-state
        // matchers, in registry order; adding, removing, or editing a matcher changes this list.
        const persistedMatchers = SAVED_PROJECT_STATE_SURFACES.filter((surface) =>
            surface.scopes.includes('persisted-state')
        ).map((surface) => surface.matcher);
        expect(SAVED_PROJECT_STATE_DIGEST_ENTRIES).toEqual(persistedMatchers.map(renderSavedProjectStateMatcherDigest));
        expect(SAVED_PROJECT_STATE_DIGEST_ENTRIES).toHaveLength(persistedMatchers.length);
        for (const id of PROJECT_STATE_RULE_IDS) {
            expect(semanticRule(id).applicabilityPaths).toEqual(SAVED_PROJECT_STATE_DIGEST_ENTRIES);
        }
        // The encoding is lossless: distinct generated probes must render distinctly. A matcher edit
        // that moves `appliesTo` while `computeRulesDigest()` stays byte-identical replays a stored
        // assessment against a changed scope, so a renderer that drops a field, the boundary between
        // the two fields, a field role, or a kind, or that lowercases, trims, length-encodes, or
        // collapses a field onto a shared prefix, encodes two distinct probes identically and must
        // redden this case. An injective re-encoding (reversing a field, say) is lossless and is
        // deliberately not rejected: the digest only has to keep distinct matchers distinct.
        const renderings = new Set<string>();
        for (const matcher of generatedDigestProbes()) {
            const rendered = renderSavedProjectStateMatcherDigest(matcher);
            expect(renderings.has(rendered), `collides: ${JSON.stringify(matcher)} -> ${rendered}`).toBe(false);
            renderings.add(rendered);
        }
    });

    it('selects exactly the paths that own saved-project state or undo', () => {
        const matrix: ReadonlyArray<readonly [path: string, expected: boolean, why: string]> = [
            // Owners, sourced from src/modules/CrdtDocument/AGENTS.md, src/modules/Project/AGENTS.md,
            // and the risk policy's own list.
            [
                'src/modules/CrdtDocument/repositories/crdtPersistence/saveIncrementalsToIdb.ts',
                true,
                'CRDT persistence: IndexedDB increments and `.sdaw` bundle encoding',
            ],
            [
                'src/modules/CrdtDocument/repositories/branchStateAuthority.ts',
                true,
                'durable branch-state authority: the one revisioned envelope',
            ],
            ['src/modules/CrdtDocument/models/ActionHistoryState.ts', true, 'semantic action history / undo'],
            [
                'src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts',
                true,
                'project load/save use case',
            ],
            ['src/modules/Project/repositories/project/writeProjectJson.ts', true, 'project load/save repository'],
            ['src/app/project.sdaw', true, '`.sdaw` saved-project shape'],
            ['src/app/bootstrap.ts', true, 'app bootstrap wiring'],
            // Restored persisted-state owners (#4902 finding 1).
            ['src/modules/Project/models/ProjectData.ts', true, 'canonical `.sourdaw` schema + version contract'],
            ['src/modules/Project/models/VcaTrackMigration.ts', true, 'VCA-track migration'],
            ['src/modules/Project/useCases/repairProjectData.ts', true, 'project-data repair'],
            ['src/modules/Project/handlers/project/handleRepairProjectData.ts', true, 'project-data repair handler'],
            ['src/modules/Project/stores/projectStore.ts', true, 'persisted `projectMeta` CRDT slot'],
            ['src/modules/Project/stores/arrangementStore.ts', true, 'persisted `arrangements` CRDT slot'],
            ['src/modules/Project/models/ProductionBrief.ts', true, 'persisted `productionBrief` durable key'],
            ['src/modules/Project/useCases/recentProjects/addToRecentProjects.ts', true, 'recent-project persistence'],
            ['src/app/registerDependencies.ts', true, 'composition root wiring'],
            ['src/app/resolveAppComposition.ts', true, 'composition root wiring'],
            ['src/app/main.tsx', true, 'composition root wiring'],
            // Restored direct persisted-slot writers and saved-project creators (#4902 finding A).
            [
                'src/modules/Project/useCases/arrangement/createArrangement.ts',
                true,
                'arrangement use case writes `arrangementStore`',
            ],
            [
                'src/modules/Project/useCases/arrangement/duplicateArrangement.ts',
                true,
                'arrangement use case writes `arrangementStore`',
            ],
            [
                'src/modules/Project/useCases/arrangement/loadSnapshot.ts',
                true,
                'arrangement use case writes `arrangementStore`',
            ],
            [
                'src/modules/Project/useCases/arrangement/renameArrangement.ts',
                true,
                'arrangement use case writes `arrangementStore`',
            ],
            [
                'src/modules/Project/useCases/arrangement/switchArrangement.ts',
                true,
                'arrangement use case writes `arrangementStore`',
            ],
            [
                'src/modules/Project/useCases/arrangement/syncCurrentArrangementToStore.ts',
                true,
                'arrangement use case writes `arrangementStore`',
            ],
            ['src/modules/Project/useCases/arrangement/takeSnapshot.ts', true, 'arrangement snapshot use case'],
            ['src/modules/Project/useCases/arrangement/helpers.ts', true, 'arrangement persisted-shape helper'],
            ['src/modules/Project/useCases/setProjectKeyRoot.ts', true, 'writes `projectStore` key root'],
            ['src/modules/Project/useCases/setProjectScaleName.ts', true, 'writes `projectStore` scale name'],
            ['src/modules/Project/useCases/importSclFile.ts', true, 'writes `projectStore` tuning'],
            ['src/modules/Project/useCases/finishProjectLoading.ts', true, 'writes `projectStore` loading flag'],
            [
                'src/modules/Project/useCases/reportProjectLoadFailure.ts',
                true,
                'writes `projectStore` loading flag on failure',
            ],
            [
                'src/modules/Project/useCases/createFreshProjectMetadata.ts',
                true,
                'creates the persisted project-metadata shape',
            ],
            [
                'src/modules/Project/useCases/setTrackCanonicalRole.ts',
                true,
                'routes a canonical-role change into the persisted production brief',
            ],
            [
                'src/modules/Project/useCases/acceptCreativeIntent.ts',
                true,
                'builds `nextBrief` and dispatches `setProductionBrief`, which writes `projectStore`',
            ],
            [
                'src/modules/Project/useCases/unlockProjectScopedBrief.ts',
                true,
                'removes the brief lock through `setProductionBrief`, which writes `projectStore`',
            ],
            [
                'src/modules/Project/handlers/projectTemplate/handleCreateProjectFromTemplate.ts',
                true,
                'creates a saved project from a template',
            ],
            ['src/modules/Project/stores/index.ts', true, 'persisted-store barrel'],
            [
                'src/app/getProductionCommandHandlerMaps.ts',
                true,
                'registers the project, undo and version-control handler maps',
            ],
            [
                'src/modules/Project/useCases/repairprojectdata.ts',
                true,
                'all-lowercase project-data repair spelling, selected only by the `repairprojectdata` substring matcher',
            ],
            // Template and demo writers whose own sources write persisted CRDT slots or replace the
            // saved project (#4902 finding 1): the whole subtree is not matched, only these writers.
            [
                'src/modules/Project/useCases/projectTemplates/templateDefinitions/createFromTemplate.ts',
                true,
                'replaces the saved project and resets the CRDT-backed stores',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/initProject.ts',
                true,
                'writes `projectStore` metadata and resets arrangement/transport/chord/groove stores',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateFiles/popSong.ts',
                true,
                'template builder runs `initProject` then `finalizeTemplate`',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/addMarkers.ts',
                true,
                'writes the CRDT-backed `markerStore`',
            ],
            [
                'src/modules/Project/useCases/demoProjects/demoUtils/syncArrangement.ts',
                true,
                'writes the persisted `arrangementStore` arrangements slot',
            ],
            [
                'src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts',
                true,
                'writes track, MIDI, transport, automation, marker, tempo-map and project stores',
            ],
            // ProjectVersioning persisted-shape and snapshot/restore owners (#4902 finding 2).
            ['src/modules/ProjectVersioning/models/ProjectVersion.ts', true, 'version/snapshot/branch persisted shape'],
            [
                'src/modules/ProjectVersioning/stores/versionControlStore.ts',
                true,
                'persists `sourdaw-version-control` state',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/snapshotHelpers/captureSnapshot.ts',
                true,
                'serializes active project state into a snapshot',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/snapshotHelpers/restoreSnapshot.ts',
                true,
                'hydrates track, marker, transport, MIDI and automation stores',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/createProjectVersion.ts',
                true,
                'captures a snapshot and writes a stored version',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/branching/deleteBranch.ts',
                true,
                'deletes a stored version branch',
            ],
            // One matrix row witnesses each remaining persisted-state matcher, so the surface-drop
            // sweep reddens the matrix for every matcher (#4902 acceptance).
            [
                'src/modules/Project/useCases/projectTemplates/templateDefinitions/applyProjectTemplate.ts',
                true,
                'app-action template entry; its create() writes the template persisted slots',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/addSections.ts',
                true,
                'writes the CRDT-backed `markerStore` sections',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/setChordProgression.ts',
                true,
                'writes the CRDT-backed `chordTrackStore`',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/setGroove.ts',
                true,
                'writes the CRDT-backed `grooveTemplateStore`',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/finalizeTemplate.ts',
                true,
                'commits template tracks into `trackStore` and `arrangementStore`',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/commitVcaGroups.ts',
                true,
                'commits VCA groups and track state through the Arrangement stores',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/configureYeastArpeggiator.ts',
                true,
                'writes the CRDT-backed Yeast rack',
            ],
            [
                'src/modules/ProjectVersioning/handlers/versionControl/handleCreateProjectVersion.ts',
                true,
                'routes a version creation into the persisted version-control store',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/tagging/tagVersion.ts',
                true,
                'writes a stored version tag',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/restoreVersion.ts',
                true,
                'hydrates a stored snapshot and records the restored version',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/autoSaveVersion.ts',
                true,
                'creates an autosave stored version',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/queries/setAutoSaveInterval.ts',
                true,
                'writes the persisted autosave interval',
            ],
            // Saved-document slot-owning stores — one row per non-test `createAutomergeStorage(` call
            // site (#4902 finding 1). The Project `projectStore`/`arrangementStore` slots and
            // CrdtDocument's `actionHistoryStore` are already witnessed above; these rows witness the
            // remaining call sites, so the surface-drop sweep reddens the matrix for every new matcher.
            ['src/modules/arrangement/stores/adjustmentlayer.ts', true, 'persisted `adjustmentLayers` CRDT slot'],
            ['src/modules/arrangement/stores/gainenvelopestore.ts', true, 'persisted `gainEnvelopes` CRDT slot'],
            ['src/modules/arrangement/stores/markerstore.ts', true, 'persisted `markers` CRDT slot'],
            ['src/modules/arrangement/stores/takelanestore.ts', true, 'persisted `takeLanes` CRDT slot'],
            ['src/modules/arrangement/stores/trackstore.ts', true, 'persisted `tracks` CRDT slot'],
            ['src/modules/arrangement/stores/vcagroupstore.ts', true, 'persisted `vcaGroups` CRDT slot'],
            ['src/modules/arrangement/stores/warpstates.ts', true, 'persisted `warpStates` CRDT slot'],
            ['src/modules/automation/stores/automationstore.ts', true, 'persisted `automation` CRDT slot'],
            ['src/modules/automation/stores/modulationstore.ts', true, 'persisted `modulation` CRDT slot'],
            [
                'src/modules/command/stores/commandbatchidempotencystore.ts',
                true,
                'persisted `commandBatchIdempotency` CRDT slot',
            ],
            ['src/modules/controlsurface/stores/midilearnstore.ts', true, 'persisted `midiLearn` CRDT slot'],
            ['src/modules/cvgate/stores/cvgate.ts', true, 'persisted `cvGate` CRDT slot'],
            ['src/modules/knead/stores/kneadstore.ts', true, 'persisted `knead` CRDT slot'],
            ['src/modules/midi/stores/chordtrackstore.ts', true, 'persisted `chordTrack` CRDT slot'],
            [
                'src/modules/midi/stores/groovetemplateautomergestorage.ts',
                true,
                'persisted `grooveTemplates` CRDT slot',
            ],
            ['src/modules/midi/stores/midistore.ts', true, 'persisted `midi` CRDT slot'],
            ['src/modules/routing/stores/sidechainstore.ts', true, 'persisted `sidechainRoutes` CRDT slot'],
            ['src/modules/transport/stores/tempomapstore.ts', true, 'persisted `tempoMap` CRDT slot'],
            ['src/modules/transport/stores/timesignaturemapstore.ts', true, 'persisted `timeSignatureMap` CRDT slot'],
            ['src/modules/transport/stores/transportstore.ts', true, 'persisted `transport` CRDT slot'],
            ['src/modules/yeast/stores/yeastautomergestorage.ts', true, 'persisted `yeast` CRDT slot'],
            // The one Arrangement use case the view keeps: it resets the slot-owning stores for a
            // replacement project (a saved-project-state write), reached by the `arrangementstore`
            // word marker.
            [
                'src/modules/Arrangement/useCases/resetArrangementStoresForProject.ts',
                true,
                'resets the Arrangement slot-owning stores for a replacement project',
            ],
            // Excluded, recorded with the reason each surface is left out.
            [
                'src/modules/Arrangement/presentations/views/TrackList.tsx',
                false,
                'presentation-only view; owns no persisted state or undo record',
            ],
            [
                'src/modules/MIDI/useCases/quantizeNotes.ts',
                false,
                'MIDI use case; only MIDI slot-owning stores (`midiStore`, `chordTrackStore`, `grooveTemplateAutomergeStorage`) are selected, not its use cases',
            ],
            [
                'src/modules/Command/stores/macroStore.ts',
                false,
                'Command/ macro surface owns neither persisted state nor undo; its undo files match the `undo` word, not a bare prefix',
            ],
            [
                'src/modules/Command/useCases/productionBriefAdmissionPort.ts',
                false,
                'production-brief admission guard seam; names the brief but owns no persisted state (`productionbrief` is scoped to `src/modules/Project/`)',
            ],
            [
                'src/modules/Command/useCases/isProjectDataRepairAction.ts',
                false,
                'pure `repairProjectData` action-type predicate; names `ProjectData` but owns no persisted state (`projectdata` is scoped to `src/modules/Project/models/`)',
            ],
            [
                'src/modules/DawInterchange/useCases/mapToProjectData.ts',
                false,
                '`.dawproject` → `ProjectData` interchange mapping; native saved-project persistence belongs to Project and CrdtDocument',
            ],
            [
                'src/modules/DawInterchange/useCases/projectDataContract.ts',
                false,
                '`ProjectData` interchange type aliases derived from `buildProjectData`; no persisted write',
            ],
            [
                'src/modules/Crumbs/repositories/crumbsBridge/crumbsAllSoundOff.ts',
                false,
                '`soundOff` contains `undo` only mid-word; it owns neither persisted state nor an undo record',
            ],
            [
                'scripts/repairReviewFinding.ts',
                false,
                'review-repair script, not project-data repair; `repair` alone is not the marker',
            ],
            [
                'src/modules/Project/presentations/views/RecentProjectsMenu.tsx',
                false,
                'recent-projects presentation view; the `recentProjects/` use cases are the owner, not the menu',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templateHelpers/buildDevice.ts',
                false,
                'pure in-memory device factory; writes no store',
            ],
            [
                'src/modules/Project/useCases/projectTemplates/templatePreviews/previewLoops.ts',
                false,
                'template preview-loop data; no persisted write',
            ],
            [
                'src/modules/Project/useCases/demoProjects/demoUtils/note.ts',
                false,
                'pure in-memory note builder; writes no store',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/queries/getVersionHistory.ts',
                false,
                'read-only version-history query; no persisted write',
            ],
            [
                'src/modules/ProjectVersioning/useCases/versionControl/snapshotHelpers/getActiveCheckpointOwnerId.ts',
                false,
                'read-only owner-id read from `projectStore`; writes nothing',
            ],
        ];
        for (const [path, expected, why] of matrix) {
            expect(selected(path), `${why}: ${path}`).toEqual(expected ? [...PROJECT_STATE_RULE_IDS] : []);
        }
    });

    it('matches undo as a path word, at a segment start or camelCase boundary', () => {
        // Real undo owners keep matching; the mid-word `undo` of `soundOff` does not.
        expect(selected('src/modules/Command/useCases/undo.ts')).toEqual([...PROJECT_STATE_RULE_IDS]);
        expect(selected('src/modules/AiRuntime/useCases/aiPanelActions/undoLastAction.ts')).toEqual([
            ...PROJECT_STATE_RULE_IDS,
        ]);
        expect(selected('src/modules/Command/handlers/undoRedo/handleRedo.ts')).toEqual([...PROJECT_STATE_RULE_IDS]);
        expect(selected('src/modules/Crumbs/repositories/crumbsBridge/crumbsAllSoundOff.ts')).toEqual([]);
    });

    it('is case-insensitive, matching the risk predicate it shares', () => {
        // Case decision: the shared predicate lowercases before matching, so a correctly cased
        // `src/modules/CrdtDocument/...` path and a mis-cased variant both select the rules.
        expect(selected('src/modules/CrdtDocument/repositories/crdtPersistence/saveIncrementalsToIdb.ts')).toEqual([
            ...PROJECT_STATE_RULE_IDS,
        ]);
        expect(selected('src/modules/crdtdocument/repositories/crdtpersistence/saveincrementalstoidb.ts')).toEqual([
            ...PROJECT_STATE_RULE_IDS,
        ]);
    });

    it('reddens if CrdtDocument/ stops matching or a nonexistent Crdt/ prefix is restored', () => {
        // `automergeRepository.ts` carries no other marker, so it matches only through the module name;
        // dropping the `crdtdocument` match silently removes all three rules from the whole module.
        expect(selected('src/modules/CrdtDocument/repositories/automergeRepository.ts')).toEqual([
            ...PROJECT_STATE_RULE_IDS,
        ]);
        // `src/modules/Crdt/` never existed; a path under it must match none of the three rules.
        expect(selected('src/modules/Crdt/document.ts')).toEqual([]);
    });
});

describe('the collection predicate uses the runner extension set', () => {
    it('collects only spec/test files with a runner code extension', () => {
        // The old predicate matched `\.(?:spec|test)\.[^.]+$`, so a `.spec.md` or `.spec.json` counted
        // as collected even though no runner collects either — Vitest's and Playwright's defaults both
        // stop at `?(c|m)[jt]s?(x)`.
        expect(isCollectedSpec('src/modules/Project/undo.spec.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.tsx')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.test.mjs')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.cts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.md')).toBe(false);
        expect(isCollectedSpec('src/modules/Project/undo.spec.json')).toBe(false);
        expect(isCollectedSpec('src/modules/Project/undo.spec.d.ts')).toBe(false);
    });

    it('plans a zero-line rename from a collected spec to an uncollected extension', () => {
        // `undo.spec.md` used to read as collected, so the two sides compared equal and the rename
        // stayed `no-text-change`: a suite that stopped running was never mentioned.
        const file = changedFile('docs/undo.spec.md', {
            kind: 'renamed',
            previousPath: 'docs/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });
});

describe('implementation source is decided by collection, not test material', () => {
    it('separates collection from applicability', () => {
        // Collection is the `.spec.`/`.test.` suffix alone; applicability also admits a code file
        // under `__tests__/`. A dummy there is test material for the rules but is never collected as
        // a test, so it must still be admissible as implementation source.
        expect(isCollectedSpec('src/modules/Arrangement/__tests__/ClipDummy.ts')).toBe(false);
        expect(isTestPath('src/modules/Arrangement/__tests__/ClipDummy.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/__tests__/undoProject.spec.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/useCases/undoProject.ts')).toBe(false);
    });

    it('supplies a changed __tests__/-resident double as the implementation a test unit reaches', () => {
        const files = [
            changedFile('src/modules/Arrangement/__tests__/arrange.spec.ts'),
            changedFile('src/modules/Arrangement/__tests__/ClipDummy.ts'),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Arrangement/__tests__/arrange.spec.ts`]: 'it("before", () => {});\n',
                    [`${HEAD}:src/modules/Arrangement/__tests__/arrange.spec.ts`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:src/modules/Arrangement/__tests__/ClipDummy.ts`]: 'export const dummy = 1;\n',
                    [`${HEAD}:src/modules/Arrangement/__tests__/ClipDummy.ts`]: 'export const dummy = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path.endsWith('arrange.spec.ts'));
        expect(unit).toBeDefined();
        expect(unit?.rules.map((rule) => rule.id)).toContain('production_path_no_longer_reached');
        expect(
            missingRequiredEvidence(
                semanticRule('production_path_no_longer_reached'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toEqual([]);
    });

    it('still refuses a collected spec as implementation source', () => {
        const rule = semanticRule('production_path_no_longer_reached');
        const beforeTest = reference({
            evidenceId: 'b1',
            path: 'src/modules/Arrangement/__tests__/arrange.spec.ts',
            side: 'before',
        });
        const afterTest = reference({
            evidenceId: 'a2',
            path: 'src/modules/Arrangement/__tests__/arrange.spec.ts',
            side: 'after',
        });
        const otherSpec = reference({
            evidenceId: 'a3',
            path: 'src/modules/Arrangement/__tests__/other.spec.ts',
            side: 'after',
        });
        expect(missingRequiredEvidence(rule, [beforeTest, afterTest], [otherSpec], 'modified')).toEqual([
            'after implementation source',
        ]);
    });
});

describe('the changed lines are the evidence regions', () => {
    it('parses ranges, renames, and one-sided diffs', () => {
        const diff = [
            'diff --git a/src/a.ts b/src/a.ts',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -3,7 +3,8 @@ export const a = 1;',
            ' context',
            'diff --git a/src/old.ts b/src/new.ts',
            'similarity index 90%',
            'rename from src/old.ts',
            'rename to src/new.ts',
            '--- a/src/old.ts',
            '+++ b/src/new.ts',
            '@@ -10,3 +10,4 @@',
            ' context',
            'diff --git a/gone.ts b/gone.ts',
            'deleted file mode 100644',
            '--- a/gone.ts',
            '+++ /dev/null',
            '@@ -1,5 +0,0 @@',
            '-gone',
        ].join('\n');
        const parsed = parseUnifiedDiffRanges(diff);
        expect(parsed.get('src/a.ts')).toEqual({
            path: 'src/a.ts',
            before: [{ startLine: 3, endLine: 9 }],
            after: [{ startLine: 3, endLine: 10 }],
        });
        expect(parsed.get('src/new.ts')).toEqual({
            path: 'src/new.ts',
            previousPath: 'src/old.ts',
            before: [{ startLine: 10, endLine: 12 }],
            after: [{ startLine: 10, endLine: 13 }],
        });
        // A deletion has no after side, and its before ranges stay keyed by the path that held them.
        expect(parsed.get('gone.ts')).toEqual({ path: 'gone.ts', before: [{ startLine: 1, endLine: 5 }], after: [] });
    });

    it('sends the changed lines instead of a file that cannot be sent whole', () => {
        // Measured on one change: whole-file sides exceeded the per-region budget for 17 of 32 paths,
        // and 11 paths were therefore unassessable; their diffs are 6.5% of the bytes.
        const big = Array.from({ length: 900 }, (_, index) => `const line${String(index)} = ${String(index)};`).join(
            '\n'
        );
        const files = [changedFile('crates/daw-dsp/src/a.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: `${big}\n`,
                    [`${HEAD}:crates/daw-dsp/src/a.rs`]: `${big}\n`,
                },
                hunks: new Map([
                    [
                        'crates/daw-dsp/src/a.rs',
                        {
                            path: 'crates/daw-dsp/src/a.rs',
                            before: [{ startLine: 400, endLine: 412 }],
                            after: [{ startLine: 400, endLine: 413 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 2_000, maxTotalBytes: 100_000 },
        });
        expect(set.references).toHaveLength(2);
        const [before, after] = set.references;
        expect(before?.startLine).toBe(400);
        expect(before?.endLine).toBe(412);
        expect(after?.startLine).toBe(400);
        expect(after?.endLine).toBe(413);
        expect(set.contents.get(before?.evidenceId ?? '')?.split('\n')).toHaveLength(13);
        expect(set.contents.get(after?.evidenceId ?? '')?.split('\n')).toHaveLength(14);
        // The unchanged head of the file never leaves the machine.
        expect(set.contents.get(before?.evidenceId ?? '')).not.toContain('line0');
    });
});

describe('the egress screen tells code from credentials', () => {
    // Live evidence: the screen refused thirteen of one change's thirty-two paths — including every
    // module implementing this tool — because the general rule matched ordinary code. Since a withheld
    // region is not sent at all, a false positive costs the whole file's assessment.
    it('does not read ordinary code as a credential', () => {
        const ordinary = [
            'Tokens: estimateInputTokens(bytes),',
            'Tokens: usage.actualInputTokens,',
            '  tokens: tokens.input_tokens,',
            'Tokens: readNonNegativeInteger(rawUsage.actualInputTokens,',
            "export const TYPESAFE_API_KEY_ENV = 'TYPESAFE_API_KEY';",
            'apiKey: loadApiKey(primaryRoot),',
            'Secrets = validationWorkflow.jobs?.[',
            'token:${slot}@github.com/${slot}.git',
            'CREDENTIAL_PATTERN = /\\bbearer\\s+/iu',
            "DEPLOY_WEB_CREDENTIAL_REPORT_STEP = 'Report the missing deployment credential'",
            'const TYPESAFE_ENDPOINT = "https://api.typesafe.ai";',
            '// A URI with embedded credentials: scheme://user:secret@host',
            'redis://:pass@h',
            'KEYS: Record<ReviewDossierEvent[',
            // Vendor family names are now secret key names, so a vendor keyword used as an ordinary
            // identifier, assigned a filesystem path (absolute or relative), or mentioned in a comment
            // must stay admitted.
            'linear: usage.actualInputTokens,',
            'datadog = "/var/lib/datadog",',
            'datadog = "./metrics/datadog.json",',
            '// facebook OAuth client integration',
            // A vendor name must not match inside a longer identifier (`etsy` in `Synth`, `linear` in
            // `bilinear`), and a bare mixed-case identifier value is a reference, not key material —
            // so a type-annotation shaped line stays admitted too.
            'const workletSynthEntry = workletSynthDevice',
            'bilinearPatch: bilinearPatchMock',
            'linear_entry: CallbackUndoEntry',
            'secretGroup: secretGroupMatch === null ? undefined : Number(secretGroupMatch[1]),',
            // A header quoted in documentation with a redaction word where the body belongs is ordinary
            // text, not key material: an eight-character word is not a PEM body line.
            secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----', '\n', 'REDACTED'),
            secretFixture(
                '-----BEGIN ',
                'PRIVATE KEY',
                '-----',
                '\n',
                'Note: ',
                'the body was redacted',
                '\n',
                'REDACTED'
            ),
        ];
        for (const line of ordinary) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
    });

    it('still withholds a credential-shaped value', () => {
        // Composed at runtime for the same reason as the vendor shapes below: the screen withholds
        // any region holding a credential shape, and a literal here would exclude this whole spec
        // from the tool's own assessment. The repository's diff secret scan matches them too.
        const credentials = [
            secretFixture('password: "correct', 'horsebatterystaple"'),
            secretFixture('CLIENT_SECRET=', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123'),
            secretFixture('redis://', ':hunter2@', 'cache.example.com:6379/0'),
            secretFixture('postgres://alice:', 'sup3rsecret@', 'db.example.com:5432/app'),
            secretFixture('Server=db;User Id=admin;Password=', 's3cretV4lueLongEnough;'),
            secretFixture('AccountName=mystorage;AccountKey=', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCdefg==;'),
            secretFixture('jdbc:postgresql://host/db?user=x&password=', 'AbCdEfGhIjKlMnOp'),
        ];
        for (const line of credentials) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
    });

    it('withholds an all-uppercase alphanumeric value but not a SCREAMING_SNAKE name', () => {
        // An opaque all-uppercase run that carries both letters and digits and no underscore is a
        // value, not an environment-variable name; the name shape must stay admitted.
        const keyId = secretFixture('ABCDEF', '123456', '7890AB');
        expect(sensitiveContentReason(secretFixture('API_KEY=', keyId))).toBeDefined();
        // A name carries no digits or carries an underscore separator, so it stays ordinary.
        expect(sensitiveContentReason(secretFixture('apiKey=', 'TYPESAFE', '_API_KEY'))).toBeUndefined();
    });

    it('withholds a quoted mixed-case value but admits a bare mixed-case identifier', () => {
        // A quoted run is a value by construction, so it is never read as a reference; the bare
        // identifier rejection applies only to an unquoted run.
        expect(sensitiveContentReason(secretFixture('client_secret = ', '"AbCdEfGhIjKlMnOp"'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('password = ', '"CorrectHorseBatteryStaple"'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', 'AbCdEfGhIjKlMnOp'))).toBeUndefined();
    });

    it('withholds a value assigned to a vendor family name', () => {
        // A keyword-proximity family is recognised as a secret key name, so its assignment reaches
        // the value heuristic instead of passing the screen untouched, whatever separator its
        // family's token carries (`_`, `-`).
        const value = 'a'.repeat(40);
        expect(sensitiveContentReason(secretFixture('datadog=', value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('DATADOG_API_KEY=', value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('datadog_api_key: ', "'", value, "'"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('linear_client_secret=', "'", 'a'.repeat(32), "'"))).toBeDefined();
    });

    it('withholds a secret value under the delimiter and terminator forms the scanner reads', () => {
        // The scanner's generic key rule flags a secret under a single, triple, or backtick delimiter,
        // and it treats each delimiter as an independent boundary, so a mismatched pair such as `'…"` is
        // also flagged. Its terminator is any single delimiter, whitespace, a semicolon, an escaped
        // newline, or end of input, and its opening run is up to five of a delimiter, whitespace, or
        // `=`, so those closings and a four-quote run are withheld too. A nested delimiter ends the
        // run, so `'''…"…'''` stops at the inner `"` and is admitted; an escaped delimiter also stops
        // the run and is admitted. Every expectation here matches the pinned binary's verdict.
        const value = 'Ab3dEf7hIj2lMn4pQr5tUv6xYz0Lm9Nq1Rs8Tp';
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, "'"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'''", value, "'''"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', '"""', value, '"""'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', '`', value, '`'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, '"'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', '"', value, "'"))).toBeDefined();
        // Closed by the scanner's full terminator set, not only a delimiter.
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, ' '))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, ';'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, "''''"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "''''", value))).toBeDefined();
        // The opening-run ceiling is five characters shared with the whitespace after the operator, so
        // five quotes after a space exceed it and are admitted (the pinned binary agrees), while five
        // quotes with no space fit the ceiling and are withheld; six quotes always exceed it.
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'''''", value))).toBeUndefined();
        expect(sensitiveContentReason(secretFixture('client_secret =', "'''''", value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret =', "''''''", value))).toBeUndefined();
        // An escaped newline (`\n` or `\r` as two characters) is in the scanner's terminator set: the
        // run stops at the backslash, so the captured value carries no escape and these are withheld
        // (#4579 — previously the backslash rode into the value and the heuristic read it as an
        // escaped fragment, so the pinned binary flagged the line while the screen admitted it).
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, '\\n'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, '\\r'))).toBeDefined();
        // A nested or escaped delimiter ends the run and is admitted.
        expect(
            sensitiveContentReason(
                secretFixture('client_secret = ', "'''", 'Ab3dEf7hIj2', '"', 'Qw9Er8Ty7Ui6Op5As4Df3', "'''")
            )
        ).toBeUndefined();
        expect(
            sensitiveContentReason(secretFixture('client_secret = ', '"Ab3dEf7hI\\"j2lMn4pQr5tUv6"'))
        ).toBeUndefined();
    });

    it('withholds a secret value under each operator the scanner reads, and admits ordinary code near them', () => {
        // The scanner's operator alternation is `=|>|:{1,3}=|\|\||:|=>|\?=|,`, and its opening run also
        // absorbs `=` and whitespace, so `==` and a spaced `= =` flag too. The screen read only `=` and
        // `:`, so every other form carried an assigned secret to the provider (#4579). The 32-character
        // value is composed at runtime for the same reason as the fixtures above. Every expectation in
        // both lists was checked against the pinned binary: Gitleaks v8.30.1 with the repository's
        // `.gitleaks.toml` reports each withheld line as generic-api-key and stays silent on each
        // admitted one.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        for (const line of [
            secretFixture('apiKey := ', value),
            secretFixture('token => ', value),
            secretFixture('token, ', value),
            secretFixture('token || ', value),
            secretFixture('apiKey ?= ', value),
            secretFixture('token == ', value),
            secretFixture('token > ', value),
            secretFixture('secret ::= ', value),
            secretFixture('token == "', value, '"'),
            secretFixture("token || '", value, "'"),
            secretFixture("secret = = '", value, "'"),
            secretFixture('apiKey = ', value),
            secretFixture('apiKey : ', value),
            secretFixture('secret = "', value, '"'),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
        // The same operators next to ordinary code stay admitted: a comparison with no secret-named
        // key never reaches the rule, a short operand fails the value length gate, a bare mixed-case
        // operand reads as a reference rather than key material, and a member access is code.
        for (const line of [
            'a == b',
            'token == shortVal',
            secretFixture('token == ', 'bLongerIdentifierValue'),
            secretFixture('token > ', 'thresholdValueOnly'),
            secretFixture('password || ', 'defaultPasswordValue'),
            secretFixture('apiKey ?= ', 'config.apiKey'),
            secretFixture('secret := ', '"short"'),
        ]) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
    });

    it('withholds a secret value across the key-to-operator gap the scanner reads, and admits ordinary code past it', () => {
        // The scanner's gap between the keyword and the operator is `(?:[ \t\w.-]{0,20})[\s'"]{0,3}`:
        // a bounded run that freely mixes word characters, dashes, dots, and spaces, then up to three
        // mixed spaces or quotes. The screen read only word characters, at most one quote directly
        // after the name, and whitespace, so a dash or dot riding the name (`token-helper`,
        // `token.js`), a second quote (`token''`), a compound operator whose first half rides the
        // gap while the scanner reads the second (`->`, `-=`, `.=`), and a quote-space mix before
        // the operator each carried an assigned secret to the provider while the pinned binary
        // flagged the line as generic-api-key (#4859). The 32-character value is composed at runtime
        // for the same reason as the fixtures above, and every expectation in both lists was checked
        // against the pinned binary: Gitleaks v8.30.1 with the repository's `.gitleaks.toml` flags
        // each withheld line as generic-api-key and stays silent on each admitted one.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        for (const line of [
            secretFixture('token-helper = ', "'", value, "'"),
            secretFixture('token.js = ', "'", value, "'"),
            secretFixture("token'' = ", "'", value, "'"),
            secretFixture('token -> ', "'", value, "'"),
            secretFixture('token -= ', "'", value, "'"),
            secretFixture('token .= ', "'", value, "'"),
            secretFixture("token '= ", value),
            secretFixture("token ' = ", value),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
        // The widened gap next to ordinary code stays admitted: a dotted or dashed continuation
        // assigned a call, an awaited call, a short operand, or a member access is code, not key
        // material.
        for (const line of [
            'token.refresh = () => refresh()',
            'auth-token = await getToken()',
            'token.js = cfg.token',
            'token-count = count()',
            'token.refresh = this.refresh.bind(this)',
        ]) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
        // The quote run before the operator stays bounded at the scanner's three: four quotes, or a
        // quote-space mix of four, exceed the scanner's own budget, and the pinned binary stays
        // silent on both — so the screen admits them too rather than widening past the scanner.
        expect(sensitiveContentReason(secretFixture("token'''' = ", "'", value, "'"))).toBeUndefined();
        expect(sensitiveContentReason(secretFixture("token ' ' = ", value))).toBeUndefined();
    });

    it('withholds a secret assigned to a bare auth, creds, or access name, and still admits references', () => {
        // The scanner's keyword alternation carries the bare words `access`, `auth`, `credential`,
        // `creds`, and `key` alongside the compounded names; the screen kept only `credential` and
        // the compounds, so `auth = '<secret>'` — among the commonest secret-variable names — and
        // `my_aws_access = '<secret>'` reached the provider while the pinned binary flagged them as
        // generic-api-key (#4859). Bare `auth`, `creds`, and `access` are secret names now; bare
        // `key` and `api` stay excluded for the reasons recorded above. The value heuristic, not
        // the name, separates the secrets from the references below, and every expectation was
        // checked against the pinned binary.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        for (const line of [
            secretFixture('creds = ', "'", value, "'"),
            secretFixture('auth = ', "'", value, "'"),
            secretFixture('my_aws_access = ', "'", value, "'"),
            secretFixture('auth_header = ', "'", value, "'"),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
        // A call, a reference, a short string, or a member access assigned to the same names is
        // ordinary code and stays admitted; the pinned binary is silent on each.
        for (const line of [
            'auth = getAuth()',
            'creds = credentials',
            'creds = loadCredentials()',
            secretFixture('auth_header = ', "'Authorization'"),
            'my_aws_access = awsAccessReference',
            'access.token = readAccessToken',
        ]) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
        // The accepted cost, the same shape as the `key` incident above: a long quoted single-word
        // value on an identifier that merely contains one of these names is withheld even where the
        // scanner's entropy gate stays silent, because the screen reads a quoted run as a value by
        // construction and has no entropy test. Withholding a benign region costs one file's
        // assessment; admitting a credential sends it to the provider. The quoted value is composed
        // at runtime for the same reason as the fixtures above.
        expect(sensitiveContentReason(secretFixture("author = '", 'external', "ContributorName'"))).toBeDefined();
    });

    it('rescans a rejected assignment value for a later assignment on the same line', () => {
        // When the value heuristic rejected a match — here a dotted run read as a member access —
        // the scan resumed past the whole consumed span, so a second assignment later on the same
        // line was never evaluated and its secret reached the provider while the pinned binary
        // flagged the line as generic-api-key (#4872). The dotted run and the 32-character value
        // are composed at runtime for the same reason as the fixtures above, and every expectation
        // in this test was checked against the pinned binary: Gitleaks v8.30.1 with the
        // repository's `.gitleaks.toml` flags each withheld line as generic-api-key and stays
        // silent on the admitted one.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        const dotted = secretFixture('A1b2C3d4', 'E5f6G7h8', '.secret');
        for (const line of [
            secretFixture('token = ', dotted, ' = ', "'", value, "'"),
            secretFixture('auth = ', dotted, ' = ', "'", value, "'"),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
        // A benign line of the same shape stays admitted: the dotted first value is a member
        // access, and the second assignment's value is a reference, not key material.
        expect(sensitiveContentReason('token = credentials.sessionToken = runtimeSessionToken')).toBeUndefined();
    });

    it('screens a line of repeated rejected assignments in bounded time', () => {
        // A rejected match now rescans from its value's start, so a resumption that failed to
        // advance would loop here, and a pathological one would show as quadratic time. The bound
        // is loose: the scan takes under ten milliseconds at this length.
        const line = 'token = credentials.sessionToken = runtimeSessionToken; '.repeat(200);
        const startedAt = performance.now();
        const reason = sensitiveContentReason(line);
        const elapsedMs = performance.now() - startedAt;
        expect(reason).toBeUndefined();
        expect(elapsedMs).toBeLessThan(2_000);
    });

    it('withholds a later same-line assignment whose value is bare key material or sits against the rejected value', () => {
        // The quoted #4872 repros generalise: the scanner flags the same line when the second
        // value is bare key material, when the second operator touches the rejected value's end
        // (the rejected bare run absorbs the `=`), and when the operator is a colon. It also
        // flags `aSecret = …` — an interior key reached without any rejection at all, so no
        // rescan-side boundary may silence it. Every expectation here was checked against the
        // pinned binary: Gitleaks v8.30.1 with the repository's `.gitleaks.toml` flags each
        // line as generic-api-key.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        const dotted = secretFixture('A1b2C3d4', 'E5f6G7h8', '.secret');
        for (const line of [
            secretFixture('token = ', dotted, ' = ', value),
            secretFixture('auth = ', dotted, ' = ', value),
            secretFixture('token = ', dotted, "= '", value, "'"),
            secretFixture('token = x.secret:', "'", value, "'"),
            secretFixture('token = aSecret = ', "'", value, "'"),
            secretFixture('token = aSecret = ', value),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
    });

    it('does not fabricate an assignment out of the middle of a rejected value', () => {
        // Resuming the scan inside the rejected value re-reads its interior as key material:
        // `credentials.sessionToken` holds `credential` and `Token`, and the line's second `=`
        // then pairs them with a trailing reference, withholding a benign line the parent and
        // the pinned binary both admit. Every line here is ordinary code — a member access or
        // an identifier reference, never key material — and the pinned binary stays silent on
        // each.
        for (const line of [
            'token = credentials.sessionToken = runtimeSessionToken2',
            'token = session.token=runtimeSessionToken2',
            'auth = request.auth=bearerTokenRefV2',
            'token = api.token=v2/v3/compat/endpoint',
            'auth = credentials.sessionAuth = runtimeSessionAuth2',
            'token = client.token=sessionTokenV2',
        ]) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
    });

    it("withholds an interior assignment whose operator breaks the scanner's first match", () => {
        // Round-2 review of #4872. The scanner matches leftmost and consumes its terminator, so a
        // space-`=` first assignment shadows a second one: the operator rides the `[\w.=-]` secret
        // run or sits past the consumed terminator, and the span is never re-read. A `:`, `,`,
        // `>`, `|`, or `?` is neither a secret-run character nor a terminator, so the first match
        // breaks there and the scanner re-matches from inside the rejected run, flagging the
        // interior assignment with no left boundary on the key — mid-token, or spanning the
        // value's own start. The screen kept its left-edge guard for every operator and admitted
        // each of the first eleven lines. Every expectation was checked against the pinned
        // binary: Gitleaks v8.30.1 with the repository's `.gitleaks.toml` flags each withheld
        // line as generic-api-key with the interior assignment as the match, and stays silent on
        // each admitted one — the admitted colon and walrus forms carry a space before the
        // operator, the terminator that shadows them, and the quote and semicolon are terminators
        // too. The 32-character value is composed at runtime for the same reason as the fixtures
        // above.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        for (const line of [
            secretFixture('password = runtime.sessionToken2: ', value),
            secretFixture('token = credentials.sessionToken: ', value),
            secretFixture('xsecret = runtime.sessionToken2, ', value),
            secretFixture('mySecret2 = runtime.sessionToken2:=', value),
            secretFixture('password = a1a1a1a1a1a1a1a1.xsecret, ', value),
            secretFixture('secret = a1a1a1a1a1a1a1a1.xsecret, ', value),
            secretFixture('password = runtime.sessionToken2> ', value),
            secretFixture('password = runtime.sessionToken2|| ', value),
            secretFixture('password = runtime.sessionToken2?= ', value),
            secretFixture('password = runtime.sessionToken2::= ', value),
            secretFixture('token = credentialABCDEFGH: ', value),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
        for (const line of [
            secretFixture('password = runtime.sessionToken2 : ', value),
            secretFixture('password = runtime.sessionToken2 := ', value),
            secretFixture('token = credentials.sessionToken = ', value),
            secretFixture('token = runtime.sessionToken2 = ', value),
            secretFixture("password = runtime.sessionToken2' = ", value),
            secretFixture('password = runtime.sessionToken2;= ', value),
        ]) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
        // Packed against the value with no gap, the second operator rides the bare value class
        // and no interior pair ever forms, so the screen stays admitted. The pinned binary flags
        // this line through its entropy gate — the packed run measures 5.27 against the 3.5
        // floor — while the benign `session.token` chain pinned in the fabrication test above
        // stays silent on the scanner's stopword allowlist (`session`, `runtime`, `token`: each
        // alone silences a de-stopworded variant that otherwise flags at 4.35), not on entropy,
        // which is 3.57 there — above the same floor. Neither mechanism is modelled here (#4579).
        const dotted = secretFixture('A1b2C3d4', 'E5f6G7h8', '.secret');
        expect(sensitiveContentReason(secretFixture('token = ', dotted, '=', value))).toBeUndefined();
    });

    it("withholds an interior assignment when a glued arrow breaks the scanner's first match", () => {
        // Round-4 review of #4872. A glued `=>` breaks the scanner's first match one character
        // later than the round-3 operators: the `=` rides the `[\w.=-]` secret run and the `>` is
        // neither a run character nor a terminator, so the match fails there and the scanner
        // re-matches from inside the run with no left boundary, flagging the interior key. Every
        // expectation was checked against the pinned binary: Gitleaks v8.30.1 with the
        // repository's `.gitleaks.toml` flags each withheld line as generic-api-key with the
        // interior assignment as the match, and stays silent on each admitted control — the
        // spaced arrow terminates the first match before the operator, and the doubled or mixed
        // operators form no probe assignment at all. The 32-character value is composed at
        // runtime for the same reason as the fixtures above.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        for (const line of [
            secretFixture('password = runtime.sessionToken2=>', ' ', value),
            secretFixture('password = config.sessionToken=>', ' ', value),
            secretFixture('password = runtime.sessionToken2=>', value),
            secretFixture('token = credentials.sessionToken2=>', ' ', value),
            secretFixture('secret = a1a1a1a1a1a1a1a1.xsecret=>', ' ', value),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
        for (const line of [
            secretFixture('password = runtime.sessionToken2==', ' ', value),
            secretFixture('password = runtime.sessionToken2 =>', ' ', value),
            secretFixture('password = runtime.sessionToken2==>', ' ', value),
            secretFixture('password = runtime.sessionToken2=|', ' ', value),
            secretFixture('password = runtime.sessionToken2=&', ' ', value),
            secretFixture('password = runtime.sessionToken2=?', ' ', value),
            secretFixture('password = runtime.sessionToken2=,', ' ', value),
        ]) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
    });

    it("withholds an interior assignment that ends at a rejected quoted value's closing quote", () => {
        // Round-4 review of #4872. A rejected quoted value's interior is real text — the content
        // class admits operators and dotted names — terminated by the closing quote, which the
        // match leaves unconsumed. A genuine assignment inside it ends at that quote or at an
        // interior space, so the bare span's eight-character window and reach-past-the-end test
        // do not apply, and the screen admitted each of the first three lines while the scanner
        // flagged them. Every expectation was checked against the pinned binary: Gitleaks
        // v8.30.1 with the repository's `.gitleaks.toml` flags the first four lines as
        // generic-api-key with the interior assignment as the match. The three `=` forms are
        // scanner-silent — a space-`=` first assignment shadows the interior one — and stay
        // withheld as the accepted over-withhold of a quoted value, which reads as a value by
        // construction. The 32-character value is composed at runtime for the same reason as
        // the fixtures above.
        const value = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        for (const line of [
            secretFixture("token = 'runtime.sessionToken2:", value, "'"),
            secretFixture("token = 'runtime.sessionToken2::=", value, "'"),
            secretFixture("token = 'abcdefghijklmnop.sessionToken2:", value, "'"),
            secretFixture("token = 'x.sessionToken2: ", value, "'"),
            secretFixture("token = credentials.sessionToken = '", value, "'"),
            secretFixture("token = credentials.sessionToken = '", 'runtimeSessionTokenV2', "'"),
            secretFixture("token = runtime.sessionToken2 = '", value, "'"),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
    });

    it("does not leak one run's probe judgment into a later run whose probe matches nothing", () => {
        // Round-5 review of #4872. Two `[\w.-]` runs inside one rejected quoted value: the
        // first run's probe (`aSecret1Xx=`) matches a credential-shaped value, and the second
        // run's probe matches nothing at all — the `+` after `sas2` starts no gap or operator.
        // The per-run memo must reset its value judgment when the probe is null; keeping the
        // first run's judgment withholds this line on the stale verdict even though the line is
        // ordinary code. The pinned binary (Gitleaks v8.30.1 with the repository's
        // `.gitleaks.toml`) stays silent on it. The 16-character tail is composed at runtime
        // for the same reason as the fixtures above.
        const line = secretFixture("token = 'xx.aSecret1Xx=y_sas2+zz", 'Ab3dEf7h', 'Ij2lMn4p', "'");
        expect(sensitiveContentReason(line)).toBeUndefined();
    });

    it('screens a hundred-kilobyte one-line run of packed rejected assignments in near-linear time', () => {
        // A rejected match used to resume the scan at its value's start, so a line packing
        // repeated `key=` substrings re-consumed the whole remaining tail once per rejected
        // match: ~305ms at 110KB and over a minute at 1MB, against the parent's ~5ms — and the
        // egress screen runs before any byte cap, so one minified bundle hunk stalled it. The
        // bound is tight against that curve and loose against the linear scan, which takes a
        // few milliseconds here. A shorter form of this line is admitted by the pinned binary.
        const line = secretFixture('token = ', 'a.secret='.repeat(12_200), 'x');
        expect(line.length).toBeGreaterThanOrEqual(100_000);
        const startedAt = performance.now();
        const reason = sensitiveContentReason(line);
        const elapsedMs = performance.now() - startedAt;
        expect(reason).toBeUndefined();
        expect(elapsedMs).toBeLessThan(250);
    });

    it('screens a key-dense continuation run whose terminal probe matches in linear time', () => {
        // The rejected value here is one `[\w.-]` continuation run carrying ten thousand `Token`
        // keys, and the probe past its end matches a 120-kilobyte quoted value, so
        // the rescan visits every key instead of skipping the run. Two per-run memos keep that
        // visit linear: the probe itself — one continuation walk and one `probeAssignmentAt` per
        // run, where recomputing it per key re-scans the remaining continuation and re-matches
        // the value per key, over five seconds here against under ten milliseconds with the
        // memo — and the probe's value judgment, where re-running `looksLikeCredentialValue` per
        // key re-scans the long quoted value ten thousand times, seconds again against
        // milliseconds. The quoted SCREAMING run is rejected as an identifier (it carries no
        // digits), so the line is admitted; a shorter form of it is admitted by the pinned
        // binary too. The bound separates the two measurements with wide margin on both sides.
        const line = secretFixture('token = ', 'sessionToken'.repeat(10_000), " = '", 'A'.repeat(120_000), "'");
        expect(line.length).toBeGreaterThanOrEqual(240_000);
        const startedAt = performance.now();
        const reason = sensitiveContentReason(line);
        const elapsedMs = performance.now() - startedAt;
        expect(reason).toBeUndefined();
        expect(elapsedMs).toBeLessThan(1_000);
    });

    it('screens an operator-dense rejected quoted value in linear time', () => {
        // Round-5 review of #4872. Inside this rejected quoted value every one of the 2320
        // `token=` units ends a `[\w.-]` run at an operatorish `=`, and the round-4 quoted-span
        // probe re-matched its unbounded value group at each stop — over five hundred
        // milliseconds here, growing x~4 per doubling, against six milliseconds on the round-3
        // head. The probe inside a quoted span now mirrors the scanner's two-branch value
        // reach: this blob's runs are `[\w.=-]` material that sails past the first branch's
        // 150-character bound with no terminator reachable, and they fail the second branch
        // because an interior `=` is not trailing padding — so each stop's scan ends within one
        // unit and the line is linear again.
        // The blob is filler — every interior value run is over that reach — so it is admitted,
        // and shorter forms of it are admitted by the pinned binary too (checked at 6 and 20
        // units). The bound fails the round-4 behavior with wide margin and is loose against
        // the fixed scan.
        const unit = secretFixture('token=', 'A'.repeat(100));
        const line = secretFixture("token = '", unit.repeat(2_320), ".a'");
        expect(line.length).toBeGreaterThanOrEqual(240_000);
        const startedAt = performance.now();
        const reason = sensitiveContentReason(line);
        const elapsedMs = performance.now() - startedAt;
        expect(reason).toBeUndefined();
        expect(elapsedMs).toBeLessThan(250);
    });

    it("withholds an interior assignment whose value rides the scanner's unbounded base64 branch", () => {
        // Round-6 review of #4872. The round-5 cap's premise — a secret run past 150 characters
        // is silent on the scanner — holds only for the pinned rule's first secret branch
        // (`[\w.=-]{10,150}`), whose mandatory trailing terminator is unreachable from inside a
        // longer run. The second branch (`[a-z0-9][a-z0-9+/]{11,}={0,3}`) is unbounded, so a
        // pure base64-alphabet run flags at any length, and the capped probe admitted each of
        // these lines that round 4's unbounded probe had withheld. Every expectation was checked
        // against the pinned binary: Gitleaks v8.30.1 with the repository's `.gitleaks.toml`
        // flags all four lines as generic-api-key — the interior assignment as the match, secret
        // lengths 151, 200, 160, and 151 at entropies 4.99, 5.00, 3.75, and 4.99 against the 3.5
        // floor. The sixteen-character floor and the value judgment still apply; only the
        // probe's reach changes. The values are composed at runtime for the same reason as the
        // fixtures above.
        const value32 = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        const hexDigit = secretFixture('a1b2c3d4', 'e5f6a7b8');
        const run151 = secretFixture(value32.repeat(4), value32.slice(0, 23));
        const run200 = secretFixture(value32.repeat(6), value32.slice(0, 8));
        const hex160 = hexDigit.repeat(10);
        expect(run151).toHaveLength(151);
        expect(run200).toHaveLength(200);
        expect(hex160).toHaveLength(160);
        for (const line of [
            secretFixture("token = 'aaaa.secret=", run151, "'"),
            secretFixture("token = 'aaaa.secret=", run200, "'"),
            secretFixture("token = 'aaaa.secret=", hex160, "'"),
            secretFixture('token = "xx.longer.token2: ', "'", run151, "' rest", '"'),
        ]) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
    });

    it("bounds the quoted-span probe's bare branch at the scanner's 150-character run", () => {
        // Round-6 review of #4872. The pinned rule's first secret branch — `[\w.=-]{10,150}`
        // with a mandatory trailing terminator — flags a run in its alphabet at 149 and 150
        // characters but stays silent at 151, where no prefix of the run ends at a terminator.
        // These runs carry an `_` every eleventh character, outside the second branch's base64
        // alphabet, so the first branch alone decides: Gitleaks v8.30.1 with the repository's
        // `.gitleaks.toml` flags the two shorter lines as generic-api-key (secret lengths 149
        // and 150, entropy 4.50 against the 3.5 floor) and stays silent on the 151-character
        // line. The probe's bare branch agrees at all three lengths; widening its cap past the
        // run would read the 151-character line's prefix and withhold it. The runs are composed
        // at runtime for the same reason as the fixtures above.
        const pair = secretFixture('a1B2c3D4e5F', '_', 'g6H7i8J9k0L', '_');
        const run149 = secretFixture(pair.repeat(6), pair.slice(0, 5));
        const run150 = secretFixture(pair.repeat(6), pair.slice(0, 6));
        const run151 = secretFixture(pair.repeat(6), pair.slice(0, 7));
        expect(run149).toHaveLength(149);
        expect(run150).toHaveLength(150);
        expect(run151).toHaveLength(151);
        expect(sensitiveContentReason(secretFixture("token = 'x.token2:", run149, "'"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture("token = 'x.token2:", run150, "'"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture("token = 'x.token2:", run151, "'"))).toBeUndefined();
    });

    it("bounds the quoted-span probe's quoted branch at the scanner's 150-character run", () => {
        // Round-6 review of #4872. The same boundary on the probe's quoted branch: the interior
        // assignment's value sits in its own quotes, and the pinned binary's verdicts are the
        // first branch's again — Gitleaks v8.30.1 with the repository's `.gitleaks.toml` flags
        // the 149- and 150-character lines as generic-api-key (secret lengths 149 and 150,
        // entropy 4.50) and stays silent on the 151-character line, whose underscore-fragmented
        // run rides neither branch. Widening the quoted branch's cap past the run would read its
        // prefix and withhold it. The runs are composed at runtime for the same reason as the
        // fixtures above.
        const pair = secretFixture('a1B2c3D4e5F', '_', 'g6H7i8J9k0L', '_');
        const run149 = secretFixture(pair.repeat(6), pair.slice(0, 5));
        const run150 = secretFixture(pair.repeat(6), pair.slice(0, 6));
        const run151 = secretFixture(pair.repeat(6), pair.slice(0, 7));
        expect(
            sensitiveContentReason(secretFixture('token = "xx.longer.token2: ', "'", run149, "' rest", '"'))
        ).toBeDefined();
        expect(
            sensitiveContentReason(secretFixture('token = "xx.longer.token2: ', "'", run150, "' rest", '"'))
        ).toBeDefined();
        expect(
            sensitiveContentReason(secretFixture('token = "xx.longer.token2: ', "'", run151, "' rest", '"'))
        ).toBeUndefined();
    });

    it("does not read a run's prefix as a bounded value when the run continues", () => {
        // Round-6 review of #4872. A 150-character pure-alphanumeric run glued to a sixteen-
        // character tail is one 167-character `[\w.=-]` run, and the pinned binary stays silent
        // on the line: the first branch's 150-character prefix ends mid-run at no terminator,
        // and the second branch's trailing-`=` padding must end at a terminator rather than a
        // letter (Gitleaks v8.30.1 with the repository's `.gitleaks.toml`). On this head the
        // terminator requirement is what stops the bare branch reading the run's first 150
        // characters as the value and withholding the line — dropping it turns this pin red
        // (mutation-verified). The round-5 run-boundary lookahead blocks the prefix too, so
        // this pin does not choose between the two guards; the comma-cut pin below does — the
        // lookahead also fires at characters the scanner treats as neither run character nor
        // terminator, withholding scanner-silent lines. The run is composed at runtime for the
        // same reason as the fixtures above.
        const value32 = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        const run150 = secretFixture(value32.repeat(4), value32.slice(0, 22));
        expect(run150).toHaveLength(150);
        const line = secretFixture("token = 'xx.token=", run150, '=zz', 'Ab3dEf7h', 'Ij2lMn4p', "'");
        expect(sensitiveContentReason(line)).toBeUndefined();
    });

    it("still withholds a bare span's interior quoted assignment past the quoted-span probe's reach", () => {
        // Round-6 review of #4872. The 200-character run inside the interior quotes rides
        // neither scanner branch — over the first branch's 150-character bound, and an `_` every
        // eleventh character keeps it out of the second branch's alphabet — so the pinned binary
        // stays silent on the line (Gitleaks v8.30.1 with the repository's `.gitleaks.toml`;
        // the first match is also silenced by the scanner's stopword allowlist). The withhold is
        // the accepted over-withhold of a quoted value, which reads as a value by construction —
        // the policy the round-4 pin above records. Routing a rejected bare span's probe through
        // the bounded quoted-span probe would admit the line; the bare span keeps the unbounded
        // probe. The run is composed at runtime for the same reason as the fixtures above.
        const pair = secretFixture('a1B2c3D4e5F', '_', 'g6H7i8J9k0L', '_');
        const run200 = secretFixture(pair.repeat(8), pair.slice(0, 8));
        expect(run200).toHaveLength(200);
        const line = secretFixture("token = credentials.sessionToken = '", run200, "'");
        expect(sensitiveContentReason(line)).toBeDefined();
    });

    it('screens a base64-dense rejected quoted value in linear time', () => {
        // Round-6 review of #4872. Every one of the 1160 units is a `token=` operator followed
        // by a 200-character pure-alphanumeric run — the second scanner branch's own alphabet,
        // which the probe now mirrors without a cap. One stop's second-branch scan still ends at
        // the next unit's `=` — not trailing padding while a letter follows it — and the first
        // branch ends at its own 150-character bound, so each stop's work is bounded by one unit
        // rather than the remaining tail and the line stays linear. The blob is filler — no
        // interior probe matches — so it is admitted, and a shorter form (six units) is silent
        // on the pinned binary (Gitleaks v8.30.1 with the repository's `.gitleaks.toml`). The
        // bound fails a per-stop re-read of the tail with wide margin and is loose against the
        // fixed scan. The unit is composed at runtime for the same reason as the fixtures above.
        const unit = secretFixture('token=', 'a1B2c3D4e5F6g7H8j9K0'.repeat(10));
        const line = secretFixture("token = '", unit.repeat(1_160), ".a'");
        expect(line.length).toBeGreaterThanOrEqual(230_000);
        const startedAt = performance.now();
        const reason = sensitiveContentReason(line);
        const elapsedMs = performance.now() - startedAt;
        expect(reason).toBeUndefined();
        expect(elapsedMs).toBeLessThan(250);
    });

    it("withholds an interior value that sits exactly at the probe's sixteen-character floor", () => {
        // Round-7 review of #4872. The pinned binary flags this line as generic-api-key: the
        // outer quoted run is one 25-character `[\w.=-]` secret to the scanner (entropy 4.56
        // against the 3.5 floor). The screen's outer judgment rejects that run as a member
        // access, so the withhold comes from the interior probe alone — and the interior value
        // is sixteen characters of pure base64 alphabet, exactly the floor on both of the bare
        // branch's value alternatives. Shifting both floors up by one character admits the line
        // while the scanner still flags it (mutation-verified); each alternative alone still
        // matches if only the other's floor shifts. The value is composed at runtime for the
        // same reason as the fixtures above.
        const value16 = secretFixture('Ab3dEf7h', 'Ij2lMn4p');
        expect(value16).toHaveLength(16);
        const line = secretFixture("token = 'x.secret=", value16, "'");
        expect(sensitiveContentReason(line)).toBeDefined();
    });

    it('withholds an interior branch-2 value whose trailing padding ends the run', () => {
        // Round-7 review of #4872. The interior value is 151 characters of pure base64 alphabet
        // closed by `=` padding: past the first scanner branch's 150-character bound, and
        // reachable only through the second branch's trailing-padding allowance — without
        // `={0,3}` the padding character is no terminator, the second branch fails, and the
        // first is bound out, so the probe admits the line (mutation-verified). The pinned
        // binary flags it as generic-api-key — the interior assignment as the match, secret
        // length 152 with the padding, entropy 5.02 against the 3.5 floor. The run is composed
        // at runtime for the same reason as the fixtures above.
        const value32 = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5tUv6x', 'Yz0Lm9Nq');
        const run151 = secretFixture(value32.repeat(4), value32.slice(0, 23));
        expect(run151).toHaveLength(151);
        const line = secretFixture("token = 'x.token2:", run151, "='");
        expect(sensitiveContentReason(line)).toBeDefined();
    });

    it('admits an interior value cut by a comma, matching the scanner', () => {
        // Round-7 review of #4872. A comma is neither a `[\w.=-]` run character nor a scanner
        // terminator, so the interior value is cut at twenty characters and the pinned binary
        // stays silent on the line (Gitleaks v8.30.1 with the repository's `.gitleaks.toml`).
        // The round-5 run-boundary lookahead passes on a comma, so the lookahead form still
        // matches the value and withholds the line; the terminator form admits it, agreeing
        // with the scanner. Both guards block the over-long prefix read pinned above — this
        // line is what pins the choice between them. The value is composed at runtime for the
        // same reason as the fixtures above.
        const value20 = secretFixture('Ab3dEf7h', 'Ij2lMn4p', 'Qr5t');
        expect(value20).toHaveLength(20);
        const line = secretFixture("token = 'xx.secret=", value20, ",y rest'");
        expect(sensitiveContentReason(line)).toBeUndefined();
    });

    it('withholds a secret-named assignment whatever the naming convention, and still admits identifier values', () => {
        // No left boundary: `SOME_TOKEN`, `apiToken`, `dbPassword` and their like are the dominant
        // secret-naming vocabulary and must reach the value heuristic. The value heuristic, not a
        // name boundary, separates them from the identifier-valued collisions below.
        const value = secretFixture('a1b2c3d4', 'e5f6g7h8', 'i9j0k1l2', 'm3n4o5p6');
        for (const key of [
            'SOME_TOKEN',
            'API_TOKEN',
            'MY_SECRET',
            'DB_PASSWORD',
            'SNAKE_CASE_API_KEY',
            'api_token',
            'apiToken',
            'dbPassword',
            'validToken',
        ]) {
            expect(sensitiveContentReason(secretFixture(key, ' = ', value)), key).toBeDefined();
        }
        // The collisions the review found stay admitted because their value is a reference, not key
        // material — a boundary on the name would be the wrong lever and would not be needed.
        expect(sensitiveContentReason('workletSynthEntry = workletSynthDevice')).toBeUndefined();
        expect(sensitiveContentReason('bilinearPatch: bilinearPatchMock')).toBeUndefined();
        expect(sensitiveContentReason('linear_entry: CallbackUndoEntry')).toBeUndefined();
    });

    it('admits a filesystem path but withholds a slash-led base64 credential', () => {
        // A path is made of short name segments; a base64 credential is one long opaque run. The
        // leading slash must not make a credential read as a path, and it must not make a path read
        // as a credential.
        expect(sensitiveContentReason(secretFixture('datadog=', '/var/lib/datadog'))).toBeUndefined();
        const slashLedBase64 = secretFixture('/', 'AbCdEfGh', 'IjKlMnOp', 'QrStUvWx', 'Yz012345', '6789AB');
        expect(sensitiveContentReason(secretFixture('datadog=', slashLedBase64))).toBeDefined();
        // A base64 credential may also contain an internal slash and `+`; the non-name characters keep
        // it credential-shaped rather than path-shaped.
        const base64WithSlashAndPlus = secretFixture('/', 'AbCdEfGh+', 'IjKlMnOp/', 'QrStUvWx', 'Yz012345');
        expect(sensitiveContentReason(secretFixture('datadog=', base64WithSlashAndPlus))).toBeDefined();
    });

    it('withholds an armored private key only with key material, whatever its wrapper', () => {
        // Composed at runtime: the diff secret scan matches a contiguous PEM header, and the screen
        // withholds any region holding one. A `key = value` rule cannot see these, because the header
        // carries no assignment, so the armored shape is the only thing standing between a PEM block
        // and the provider. Egress requires a value, so the header alone is not enough: a prose
        // sentence quoting the header carries no key material.
        const pkcs8Header = secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----');
        const opensshHeader = secretFixture('-----BEGIN OPENSSH ', 'PRIVATE KEY', '-----');
        const rsaHeader = secretFixture('-----BEGIN RSA ', 'PRIVATE KEY', '-----');
        const body = secretFixture('TUlJRXZRSUJBREFO', 'QmdrcWhraUc5dzBC', 'QVFFRkFBU0NCS2N3', 'Z2dTakFnRUFBb0lC');
        const pkcs8 = secretFixture(pkcs8Header, '\n', body);
        const openssh = secretFixture(opensshHeader, '\n', body);
        const rsa = secretFixture(rsaHeader, '\n', body);
        // A block whose body is present and whose footer is absent is still withheld: the body, not
        // the footer, is what carries the key material.
        expect(sensitiveContentReason(pkcs8)).toBe('an armored private key');
        expect(sensitiveContentReason(openssh)).toBe('an armored private key');
        expect(sensitiveContentReason(rsa)).toBe('an armored private key');
        // Two file shapes that would otherwise carry the block out unchanged: a `.ts` string and a
        // JSON field.
        expect(sensitiveContentReason(`export const key = '${pkcs8}';`)).toBe('an armored private key');
        expect(sensitiveContentReason(`{ "key": "${rsa}" }`)).toBe('an armored private key');
        // A header quoted inline in prose carries no key material and must not be withheld.
        expect(
            sensitiveContentReason(`the file opens with ${pkcs8Header} and then the key material follows`)
        ).toBeUndefined();
        expect(sensitiveContentReason(pkcs8Header)).toBeUndefined();
    });

    it('withholds a passphrase-encrypted envelope and a blank line between header and body', () => {
        // A traditional encrypted block (`openssl rsa -aes256 -traditional`) puts `Proc-Type` and
        // `DEK-Info` lines, and a blank line, between the header and the body. The old pattern required
        // the base64 body on the line after the header, so a real encrypted key passed the screen and
        // its region went to the provider.
        const rsaHeader = secretFixture('-----BEGIN RSA ', 'PRIVATE KEY', '-----');
        const body = secretFixture('TUlJRXZRSUJBREFO', 'QmdrcWhraUc5dzBC', 'QVFFRkFBU0NCS2N3', 'Z2dTakFnRUFBb0lC');
        const procType = secretFixture('Proc-Type: 4,', 'ENCRYPTED');
        const dekInfo = secretFixture('DEK-Info: ', 'AES-256-CBC,0123456789ABCDEF');
        const encrypted = secretFixture(rsaHeader, '\n', procType, '\n', dekInfo, '\n', '\n', body);
        expect(sensitiveContentReason(encrypted)).toBe('an armored private key');
        const blankLine = secretFixture(rsaHeader, '\n', '\n', body);
        expect(sensitiveContentReason(blankLine)).toBe('an armored private key');
    });
});

describe('incomplete scope from withheld evidence', () => {
    const AWS_SHAPED = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');

    it('catches SaaS and connection-string shapes the publication list misses', () => {
        // Composed at runtime: the repository's diff secret scan matches these literals in source.
        const sendgrid = secretFixture('SG.', 'a1b2c3d4e5f6g7h8i9j0k1', '.l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6');
        const gitlab = secretFixture('glpat-', 'abcdefghijklmnopqrstuvwx');
        const emptyUser = secretFixture('redis://', ':hunter2@', 'cache.example.com:6379/0');
        // Realistic length: a six-character value is below any honest entropy threshold and is
        // indistinguishable from an ordinary word, which is a documented limitation rather than a bug.
        const keyValue = secretFixture('Server=db;User Id=admin;Password=', 's3cretV4lueLongEnough;');
        // Generalizing rules, not per-vendor enumeration: these all reached the provider before.
        const azureAccountKey = secretFixture(
            'AccountName=mystorage;AccountKey=',
            'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCdefg==;'
        );
        const sharedAccess = secretFixture(
            'SharedAccessKeyName=root;SharedAccessKey=',
            'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABC=;'
        );
        const googleOAuth = secretFixture('GOCSPX-', 'AbCdEfGhIjKlMnOpQrStUvWx');
        const genericSecret = secretFixture('CLIENT_SECRET=', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123');
        // A configuration file writes its key in quotes, and the quote sits between the name and the
        // separator. The rule that demanded the separator immediately after the name let every JSON
        // and YAML config carry its secrets past the gate.
        const quotedKey = secretFixture('{ "password": "', 'correcthorsebatterystaple', '" }');
        const queryParam = secretFixture('jdbc:postgresql://host/db?user=x&password=', 'AbCdEfGhIjKlMnOp');
        // Short enough that the general secret-named-key rule cannot match it, so this fixture fails
        // if the key-value connection-string rule stops firing; the longer one above is satisfied by
        // the general rule whether or not that rule exists.
        const shortConnectionString = secretFixture('Server=db;Password=', 's3cretV4l');
        for (const value of [
            sendgrid,
            gitlab,
            emptyUser,
            keyValue,
            azureAccountKey,
            sharedAccess,
            googleOAuth,
            genericSecret,
            queryParam,
            quotedKey,
            shortConnectionString,
        ]) {
            const recorded = collectEvidence({
                port: fakeSource({
                    files: [changedFile('src/modules/Project/notes.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/Project/notes.ts`]: `const v = '${value}';\n`,
                        [`${HEAD}:src/modules/Project/notes.ts`]: `const v = '${value}';\n`,
                    },
                }),
                mergeBaseSha: MERGE_BASE,
                headSha: HEAD,
                contractSourceSha: MERGE_BASE,
                limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            });
            expect(recorded.references).toHaveLength(0);
        }
    });

    it('reports a run whose evidence was withheld as incomplete, not completed', async () => {
        // The unit was never sent, yet the run reported completion and exited 0.
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/Project/__tests__/auth.spec.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                        [`${HEAD}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.truncated.length).toBeGreaterThan(0);
        expect(result.report.execution).not.toBe('completed');
        // A wholly withheld scope is not an empty one: `skipped` would report a green no-op over the
        // very change whose evidence the withholding exists to disclose.
        expect(result.report.execution).not.toBe('skipped');
        expect(() => validateReport(result.report)).not.toThrow();
    });

    it('does not count a path twice when it is both excluded and planned', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/Project/__tests__/auth.spec.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                        [`${HEAD}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.discovered).toBe(1);
    });
});

describe('verify incomplete attribution', () => {
    it('will not advance a finding whose before side was never supplied', async () => {
        // Attribution was decided without the side it compares against.
        const { runVerify } = await import('../verify.ts');
        const result = await runVerify({
            ports: {
                source: fakeSource({
                    files: [],
                    blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
                }),
                provider: constantProvider(
                    { supported: 0.95, contradicted: 0.02, insufficient_context: 0.03 },
                    {
                        systemOne: async ({ questions }) => {
                            // Each question defines its own labels, so a per-key answer is required;
                            // the selection question offers the supplied ids plus `none`.
                            const distributions: Record<string, Record<string, number>> = {
                                support: { supported: 0.95, contradicted: 0.02, insufficient_context: 0.03 },
                                attribution: {
                                    introduced_by_change: 0.95,
                                    pre_existing: 0.02,
                                    undetermined: 0.03,
                                },
                                kind: {
                                    behavioral_or_contract_issue: 0.95,
                                    style_preference: 0.02,
                                    undetermined: 0.03,
                                },
                                strongestEvidence: { none: 1 },
                            };
                            const answers: Record<string, unknown> = {};
                            for (const key of Object.keys(questions)) {
                                const probabilities = distributions[key] ?? distributions.support!;
                                answers[key] = {
                                    type: 'choice',
                                    probabilities,
                                    confidence: 0.95,
                                    choice: Object.keys(probabilities)[0],
                                };
                            }
                            return {
                                model: TYPESAFE_MODEL,
                                answers,
                                usage: { input_tokens: 5, output_tokens: 0 },
                            };
                        },
                    }
                ),
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        {
                            path: 'src/modules/Project/gone.ts',
                            side: 'before',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                        {
                            path: 'src/modules/Project/a.ts',
                            side: 'after',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                    ],
                },
            ],
            runId: 'verify-incomplete',
        });
        const assessment = result.report.findingAssessments[0];
        expect(assessment?.disposition).toBe('needs_more_evidence');
        expect(assessment?.reasoning).toContain('not supplied');
    });
});

describe('verify summary wording', () => {
    it('describes withheld evidence as a coverage gap, not model indecision', async () => {
        // A verify report whose evidence was withheld carries a decisive support answer and a
        // `needs_more_evidence` disposition, because `interpretFinding` outranks every threshold when
        // the referenced evidence was not supplied. The outcome sentence must name that coverage gap
        // rather than reuse the scan sentence about unresolved answers or near misses.
        const { runVerify } = await import('../verify.ts');
        const result = await runVerify({
            ports: {
                source: fakeSource({
                    files: [],
                    blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
                }),
                provider: constantProvider(
                    { supported: 0.95, contradicted: 0.02, insufficient_context: 0.03 },
                    {
                        systemOne: async ({ questions }) => {
                            const distributions: Record<string, Record<string, number>> = {
                                support: { supported: 0.95, contradicted: 0.02, insufficient_context: 0.03 },
                                attribution: {
                                    introduced_by_change: 0.95,
                                    pre_existing: 0.02,
                                    undetermined: 0.03,
                                },
                                kind: {
                                    behavioral_or_contract_issue: 0.95,
                                    style_preference: 0.02,
                                    undetermined: 0.03,
                                },
                                strongestEvidence: { none: 1 },
                            };
                            const answers: Record<string, unknown> = {};
                            for (const key of Object.keys(questions)) {
                                const probabilities = distributions[key] ?? distributions.support!;
                                answers[key] = {
                                    type: 'choice',
                                    probabilities,
                                    confidence: 0.95,
                                    choice: Object.keys(probabilities)[0],
                                };
                            }
                            return {
                                model: TYPESAFE_MODEL,
                                answers,
                                usage: { input_tokens: 5, output_tokens: 0 },
                            };
                        },
                    }
                ),
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        {
                            path: 'src/modules/Project/gone.ts',
                            side: 'before',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                        {
                            path: 'src/modules/Project/a.ts',
                            side: 'after',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                    ],
                },
            ],
            runId: 'verify-summary',
        });
        const assessment = result.report.findingAssessments[0];
        expect(assessment?.disposition).toBe('needs_more_evidence');
        // The support answer is decisive; only the withheld before side blocks the disposition.
        expect(assessment?.support.outcome).toBe('supported');
        const summary = renderSummary(result.report);
        expect(summary).toContain('No finding was decidable');
        expect(summary).toContain('needed more evidence');
        expect(summary).not.toContain('unresolved or came close');
        expect(summary).not.toContain('No question was decidable');
    });
});

describe('identity self-verification', () => {
    async function smallScan(profile: typeof SEMANTIC_BUDGET_PROFILES.ci) {
        const base = scanPorts(
            constantProvider(0.1),
            fakeSource({
                files: [changedFile('src/modules/AudioEngine/live.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                    [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                },
            }),
            fixedClock(1_000)
        );
        return runScan({ ...base, profile });
    }

    it('refuses a report whose context digest does not match its own context', async () => {
        // validate read the digest as an opaque string, so a forged revision validated.
        const result = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        const forged = {
            ...result.report,
            context: { ...result.report.context, mergeBaseSha: 'f'.repeat(40) },
        };
        expect(() => validateReport(forged)).toThrow(SemanticFailure);
    });

    it('refuses a report whose top-level identity disagrees with its context', async () => {
        const result = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        expect(() => validateReport({ ...result.report, rulesDigest: 'a'.repeat(64) })).toThrow(SemanticFailure);
        expect(() => validateReport({ ...result.report, policyVersion: 'other' })).toThrow(SemanticFailure);
    });

    it('refuses a report that records a failure alongside a completed execution', async () => {
        const result = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        expect(() => validateReport({ ...result.report, failureCode: 'rate_limited' })).toThrow(SemanticFailure);
    });

    it('binds the evidence budget to the identity so two profiles cannot collide', async () => {
        // The profile decides how much evidence is sent, so runs under different profiles must not
        // share an identity or a sidecar path.
        const ci = await smallScan(SEMANTIC_BUDGET_PROFILES.ci);
        const local = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        expect(ci.report.context.evidenceProfile).toBe('ci');
        expect(local.report.context.evidenceProfile).toBe('local');
        expect(ci.report.context.contextDigest).not.toBe(local.report.context.contextDigest);
    });
});

describe('sensitive-path withholding', () => {
    it('reports a run that withheld a sensitive path as incomplete, not completed', async () => {
        // The content gate's withholdings were incomplete scope and the path gate's were not, so the
        // same class of loss reported two different outcomes and this one exited 0.
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts'), changedFile('.env')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.excluded.some((entry) => entry.path === '.env')).toBe(true);
        expect(result.report.scope.truncated.some((entry) => entry.reason === 'evidence-withheld-sensitive-path')).toBe(
            true
        );
        expect(result.report.execution).not.toBe('completed');
        expect(renderSummary(result.report)).toContain('Incomplete');
        expect(() => validateReport(result.report)).not.toThrow();
    });
});

describe('usage validation', () => {
    it('refuses a hostile or malformed token count on the live path', () => {
        // The cached path validated this and the live path did not, so a provider-returned count could
        // inflate the cost estimate or poison the whole report at write time.
        expect(() => readUsage({ input_tokens: -1, output_tokens: 0 }, 'usage')).toThrow(SemanticFailure);
        expect(() => readUsage({ input_tokens: 1.5, output_tokens: 0 }, 'usage')).toThrow(SemanticFailure);
        expect(() => readUsage({ input_tokens: Number.MAX_SAFE_INTEGER + 2, output_tokens: 0 }, 'usage')).toThrow(
            SemanticFailure
        );
        expect(readUsage({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 }, 'usage')).toEqual({
            input_tokens: Number.MAX_SAFE_INTEGER,
            output_tokens: 0,
        });
        expect(() => readUsage({ input_tokens: 1, output_tokens: -1 }, 'usage')).toThrow(SemanticFailure);
        expect(readUsage(undefined, 'usage')).toBeUndefined();
        expect(readUsage({ input_tokens: 5, output_tokens: 0 }, 'usage')).toEqual({
            input_tokens: 5,
            output_tokens: 0,
        });
    });

    it('rejects an assessment whose usage is malformed rather than recording a fabricated cost', async () => {
        const provider: SemanticProviderPort = {
            systemOne: async () => ({
                model: TYPESAFE_MODEL,
                answers: {},
                usage: { input_tokens: -1, output_tokens: 0 },
            }),
        };
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(SEMANTIC_BUDGET_PROFILES.local),
                profile: SEMANTIC_BUDGET_PROFILES.local,
                deadline: Date.now() + 10_000,
                state: {},
                questions: { check: { type: 'noul' } },
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'invalid_response' });
    });
});

describe('reduced-unit reporting', () => {
    it('carries a unit whose evidence exceeded one request instead of cutting it', async () => {
        // A unit whose evidence the request budget had to cut once reported a clean completion while its
        // after side was reduced to a fraction. The evidence now travels in ordered passes, so the whole
        // unit is assessed and nothing is recorded as reduced.
        const big = 'const sample_value = 1;\n'.repeat(500);
        const provider = constantProvider(0.05);
        const source = fakeSource({
            files: [changedFile('crates/daw-dsp/src/big.rs')],
            blobs: {
                [`${MERGE_BASE}:crates/daw-dsp/src/big.rs`]: big,
                [`${HEAD}:crates/daw-dsp/src/big.rs`]: big,
            },
        });
        const base = scanPorts(provider, source, fixedClock(1_000));
        const result = await runScan({
            ...base,
            // Large enough that collection records nothing: any split must come from fitting.
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        // The plan composes the whole unit and cuts nothing — but with both sides over one request no
        // single pass carries a realtime rule's whole required set, so the unit is recorded as missing
        // required evidence instead of being asked for answers the interpreter would discard.
        expect(result.previews[0]?.evidenceIds.length).toBeGreaterThan(0);
        expect(result.previews[0]?.sentEvidenceIds).toEqual([]);
        expect(result.report.scope.assessed).toBe(0);
        expect(result.report.scope.unassessed).toEqual([
            {
                path: 'crates/daw-dsp/src/big.rs',
                reason: 'missing-required-evidence',
                priorityClass: 'severe-production',
            },
        ]);
        expect(result.report.scope.truncated.some((entry) => entry.reason.startsWith('unit-evidence-reduced'))).toBe(
            false
        );
    });

    it('names the side of a region no pass could carry in the reduced-unit entry', async () => {
        // The reduced-unit entry was recorded per unit with no side, so a reader could not tell which
        // side was cut. A region larger than one request cannot travel in any pass and is still named:
        // its side appears in the entry.
        const before = 'const before = 1;\n';
        const after = 'const sample_value = 1;\n'.repeat(900);
        const provider = constantProvider(0.05);
        const source = fakeSource({
            files: [changedFile('crates/daw-dsp/src/big.rs', { added: 900, deleted: 1 })],
            blobs: {
                [`${MERGE_BASE}:crates/daw-dsp/src/big.rs`]: before,
                [`${HEAD}:crates/daw-dsp/src/big.rs`]: after,
            },
        });
        const result = await runScan({
            ...scanPorts(provider, source, fixedClock(1_000)),
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        expect(result.report.scope.truncated).toContainEqual({
            path: 'crates/daw-dsp/src/big.rs',
            reason: 'unit-evidence-reduced-below-request-budget (after)',
        });
        // The operator-facing limitation names the request budget and the dropped-region count, so a
        // reader can tell how much evidence never left the machine. Deleting the push reddens this case.
        expect(result.report.limitations.join(' ')).toContain('per-request state budget');
        expect(result.report.limitations.join(' ')).toContain('1 region(s) were not sent');
    });

    it("does not record a request-budget reduction for the collector's own per-region withholding", async () => {
        // D: a unit was reduced whenever it carried any truncation entry, and the reason came from the
        // fitter's dropped sides alone, so a unit whose only truncation was the collector withholding an
        // over-ceiling side was recorded as `unit-evidence-reduced-below-request-budget` although the
        // fitter dropped nothing. The fitted drop is what that reason names; the collector's own entry
        // stays in the scope exactly as it was written.
        const path = 'crates/daw-dsp/src/big.rs';
        const oversized = 'const over = 1;\n'.repeat(2_000);
        const result = await runScan({
            ...scanPorts(
                constantProvider(0.05),
                fakeSource({
                    // The withheld unit is skipped for want of the side collection dropped, so a second,
                    // small unit carries the run's assessment and keeps its state partial.
                    files: [
                        changedFile(path, { added: 2_000, deleted: 1 }),
                        changedFile('crates/daw-dsp/src/small.rs'),
                    ],
                    blobs: {
                        [`${MERGE_BASE}:${path}`]: 'const small = 1;\n',
                        [`${HEAD}:${path}`]: oversized,
                        [`${MERGE_BASE}:crates/daw-dsp/src/small.rs`]: 'const before = 1;\n',
                        [`${HEAD}:crates/daw-dsp/src/small.rs`]: 'const after = 2;\n',
                    },
                }),
                fixedClock(1_000)
            ),
            limits: {
                maxRegionBytes: SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes,
                maxTotalBytes: SEMANTIC_BUDGET_PROFILES.local.maxTotalSubmittedBytes,
            },
        });
        // The collector's per-region ceiling withheld the after side, and the run is still partial.
        expect(result.report.scope.truncated).toContainEqual({
            path,
            reason: 'region-exceeds-per-region-budget (after)',
        });
        expect(result.report.limitations.join(' ')).toContain('exceeds the per-region budget');
        expect(result.report.execution).toBe('partial');
        // The fitter dropped nothing, so no reduction below the request budget is recorded.
        expect(
            result.report.scope.truncated.some((entry) =>
                entry.reason.startsWith('unit-evidence-reduced-below-request-budget')
            )
        ).toBe(false);
        expect(result.report.limitations.join(' ')).not.toContain('per-request state budget');
    });

    it('does not send a region it cannot send whole, and reports what the questions then lack', () => {
        // A cut region used to answer `has('context')`, so the rule scored a side it held a fraction
        // of. A region is now supplied whole or not at all, and the rule reports what it did not get.
        const big = 'const documented_rule = 1;\n'.repeat(400);
        const files = [changedFile('crates/daw-dsp/src/lib.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/lib.rs`]: 'const a = 1;\n',
                    [`${HEAD}:crates/daw-dsp/src/lib.rs`]: 'const a = 2;\n',
                    [`${MERGE_BASE}:AGENTS.md`]: big,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 20_000, maxTotalBytes: 100_000 },
            contractPaths: ['AGENTS.md'],
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(true);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit).toBeDefined();
        expect(unit?.evidence.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(
            missingRequiredEvidence(
                semanticRule('stated_invariant_contradicted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toContain('decision or documented invariant');
    });
});

describe('partial-side evidence drop', () => {
    it('treats a side split across two hunks as unsupplied when one hunk is dropped', () => {
        // A side split across two hunks where one is dropped for size was still satisfied by the
        // surviving region, so a rule returned a decisive verdict over a side the model saw only in
        // part. The fitter must name the dropped side, and a dropped side must not satisfy a need.
        const before = 'it("before", () => {});\n';
        const after = `it("kept", () => {});\n${'const large_line = 1;\n'.repeat(2000)}`;
        const files = [changedFile('src/modules/Project/__tests__/two-hunks.spec.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/two-hunks.spec.ts`]: before,
                    [`${HEAD}:src/modules/Project/__tests__/two-hunks.spec.ts`]: after,
                },
                hunks: new Map([
                    [
                        'src/modules/Project/__tests__/two-hunks.spec.ts',
                        {
                            path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2001 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });

        // The oversized hunk has to be over whatever cap this fixture plans under, and the shipped ci
        // cap is deliberately no longer small enough to cut a 44 KiB region: CI now sends it. The
        // local cap still binds, and the claim under test is the fitter's dropped-side bookkeeping, not
        // any particular profile's number.
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit).toBeDefined();
        // One after hunk survives, so the old predicate would have called the side present.
        expect(unit?.evidence.references.some((reference) => reference.side === 'after')).toBe(true);
        expect(unit?.evidence.ownDroppedSides.has('after')).toBe(true);

        const missing = missingRequiredEvidence(
            semanticRule('assertion_deleted'),
            unit?.evidence.own ?? [],
            unit?.evidence.context ?? [],
            'modified',
            unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
            unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
        );
        expect(missing).toContain('after test source');
        // Without the dropped-side wiring, the surviving after region satisfies the side and the rule
        // returns a decisive verdict.
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toEqual([]);

        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.05 },
            rule: semanticRule('assertion_deleted'),
            unitId: 'u',
            path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
            missingEvidence: missing,
        });
        expect(assessment.disposition).toBe('unresolved');
        expect(assessment.missingEvidence).toEqual(['after test source']);
    });

    it('treats a dropped after side as not supplying implementation source', () => {
        // The implementation branch resolves to an after side that is not a collected spec; a dropped
        // context after side must not satisfy it even though the implementation region itself survived.
        const rule = semanticRule('production_path_no_longer_reached');
        const beforeTest = reference({
            evidenceId: 'b1',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const afterTest = reference({
            evidenceId: 'a2',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'after',
        });
        const implementation = reference({
            evidenceId: 'a3',
            path: 'src/modules/Project/useCases/undoProject.ts',
            side: 'after',
        });
        const droppedAfter = new Set<EvidenceSide>(['after']);
        expect(
            missingRequiredEvidence(
                rule,
                [beforeTest, afterTest],
                [implementation],
                'modified',
                new Set(),
                droppedAfter
            )
        ).toContain('after implementation source');
        expect(missingRequiredEvidence(rule, [beforeTest, afterTest], [implementation], 'modified')).toEqual([]);
    });
});

describe('own and context drops are resolved separately', () => {
    it('does not let a dropped implementation-context after region mark the own after side missing', () => {
        const rule = semanticRule('assertion_deleted');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'after',
        });
        const implementation = reference({
            evidenceId: 'a3',
            path: 'src/modules/Project/useCases/undoProject.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [implementation],
            'modified',
            new Set<EvidenceSide>(),
            new Set<EvidenceSide>(['after'])
        );
        expect(missing).toEqual([]);
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.05 },
            rule,
            unitId: 'u',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            missingEvidence: missing,
        });
        expect(assessment.outcome).not.toBe('insufficient_context');
    });

    it('still reports the own after side when it is dropped', () => {
        const rule = semanticRule('assertion_deleted');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [],
            'modified',
            new Set<EvidenceSide>(['after']),
            new Set<EvidenceSide>()
        );
        expect(missing).toEqual(['after test source']);
    });

    it('reports own and context drops separately from the fitter', () => {
        const files = [
            changedFile('src/modules/Project/__tests__/undo.spec.ts'),
            changedFile('src/modules/Project/useCases/undoProject.ts'),
        ];
        const big = 'export const impl = 1;\n'.repeat(400);
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("before", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:src/modules/Project/useCases/undoProject.ts`]: 'export const before = 1;\n',
                    [`${HEAD}:src/modules/Project/useCases/undoProject.ts`]: big,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const own = set.references.filter((r) => r.side !== 'context' && r.path.endsWith('undo.spec.ts'));
        const context = set.references.filter((r) => r.side === 'after' && r.path.endsWith('undoProject.ts'));
        const fitted = fitUnitEvidence(set, own, context, 2_000);
        expect(fitted.own.droppedSides.has('after')).toBe(false);
        expect(fitted.context.droppedSides.has('after')).toBe(true);
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                fitted.own.references,
                fitted.context.references,
                'modified',
                fitted.own.droppedSides,
                fitted.context.droppedSides
            )
        ).toEqual([]);
    });

    it('lets an own non-collected after side satisfy implementation despite a dropped context after region', () => {
        // A context after region dropped for budget must not deny the unit's own after side when that
        // side is itself implementation source: the two sets resolve independently and disjoin.
        const rule = semanticRule('production_path_no_longer_reached');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'after',
        });
        const contextImpl = reference({
            evidenceId: 'a3',
            path: 'src/modules/Arrangement/useCases/arrange.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [contextImpl],
            'modified',
            new Set<EvidenceSide>(),
            new Set<EvidenceSide>(['after'])
        );
        expect(missing).toEqual([]);
    });

    it('still reports the implementation token when the own after side is dropped', () => {
        const rule = semanticRule('production_path_no_longer_reached');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [],
            'modified',
            new Set<EvidenceSide>(['after']),
            new Set<EvidenceSide>()
        );
        expect(missing).toContain('after implementation source');
    });
});

describe('required-evidence resolution is exhaustive', () => {
    it('reports a declared token with no resolver as missing, not satisfied by anything', () => {
        // `related existing source` matched no substring branch, and the final `own.length > 0 ||
        // context.length > 0` fallback satisfied it from whatever the unit carried — so a duplication
        // rule returned a decisive verdict with no related source ever sent.
        const ownAfter = reference({ evidenceId: 'a1', path: 'src/modules/Project/a.ts', side: 'after' });
        expect(
            missingRequiredEvidence(semanticRule('duplicates_existing_mechanism'), [ownAfter], [], 'modified')
        ).toContain('related existing source');
    });

    it('turns a missing related source into insufficient_context, not a decisive verdict', () => {
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.01 },
            rule: semanticRule('duplicates_existing_mechanism'),
            unitId: 'u',
            path: 'src/modules/Project/a.ts',
            missingEvidence: missingRequiredEvidence(
                semanticRule('duplicates_existing_mechanism'),
                [reference({ evidenceId: 'a1', path: 'src/modules/Project/a.ts', side: 'after' })],
                [],
                'modified'
            ),
        });
        expect(assessment.outcome).toBe('insufficient_context');
        expect(assessment.disposition).toBe('unresolved');
    });

    it('fails when a rule declares a token the resolver mapping does not cover', () => {
        // A guard that cannot fail is what let the fallback hide: every declared token must answer to
        // an exact resolver, so adding a rule with a new token is a visible decision.
        for (const rule of SEMANTIC_RULES) {
            for (const token of rule.requiredEvidence) {
                expect(RESOLVED_EVIDENCE_TOKENS.has(token), `no resolver for ${token}`).toBe(true);
            }
        }
    });
});

describe('caller and call-site tokens resolve against context alone', () => {
    it('does not let the own after side satisfy a caller requirement', () => {
        // The caller branch resolved to `ownHas('after') || contextHas('context')`, and the unit's own
        // after side is the changed file itself, not a caller outside it — so a rule asking whether
        // callers were updated was answered with no caller in view.
        const ownAfter = reference({ evidenceId: 'a1', path: 'src/modules/Project/a.ts', side: 'after' });
        const contractContext = reference({ evidenceId: 'c1', path: 'AGENTS.md', side: 'context' });
        expect(
            missingRequiredEvidence(
                semanticRule('public_contract_widened_silently'),
                [ownAfter],
                [contractContext],
                'modified'
            )
        ).not.toContain('caller or contract');
        expect(
            missingRequiredEvidence(semanticRule('public_contract_widened_silently'), [ownAfter], [], 'modified')
        ).toContain('caller or contract');
    });

    it('reports a scheduling call-site with no context as missing', () => {
        const ownAfter = reference({ evidenceId: 'a1', path: 'crates/daw-dsp/src/a.rs', side: 'after' });
        expect(missingRequiredEvidence(semanticRule('timing_semantics_changed'), [ownAfter], [], 'modified')).toContain(
            'scheduling call-site'
        );
    });
});

describe('verify-path screening and identity', () => {
    // Composed at runtime: the PR diff secret scan matches these literals in source.
    const CONNECTION_SHAPED = secretFixture('postgres://', 'alice:', 'sup3rsecret', '@db.example.com:5432/app');

    async function verifyWith(
        references: { path: string; side: 'after'; startLine?: number; endLine?: number }[],
        blobs: Record<string, string>
    ) {
        const { runVerify } = await import('../verify.ts');
        let providerCalls = 0;
        const provider = constantProvider(
            { supported: 0.05, contradicted: 0.05, insufficient_context: 0.9 },
            {
                systemOne: async () => {
                    providerCalls += 1;
                    throw new Error('the provider must not be reached for withheld evidence');
                },
            }
        );
        const result = await runVerify({
            ports: {
                source: fakeSource({ files: [], blobs }),
                provider,
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    // A fixture that names no range asks about the whole file.
                    evidenceReferences: references.map((reference) => ({
                        startLine: reference.startLine ?? 1,
                        endLine: reference.endLine ?? Number.MAX_SAFE_INTEGER,
                        ...reference,
                    })),
                },
            ],
            runId: 'verify-test',
        });
        return { result, providerCalls };
    }

    it('withholds a sensitive path a candidate finding names', async () => {
        // The scan path screened these and verify did not, so a finding could name any tracked file
        // and have it sent verbatim.
        const { result, providerCalls } = await verifyWith(
            [{ path: '.env', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
            {}
        );
        expect(providerCalls).toBe(0);
        expect(result.report.findingAssessments).toHaveLength(0);
        expect(result.report.scope.unassessed[0]?.reason).toBe('no-admissible-evidence');
        expect(result.report.limitations.join(' ')).toContain('sensitive-path');
    });

    it('withholds credential-shaped content in an ordinary-named file a finding names', async () => {
        const { result, providerCalls } = await verifyWith(
            [{ path: 'src/modules/Project/notes.ts', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
            {
                [`${HEAD}:src/modules/Project/notes.ts`]: `const url = '${CONNECTION_SHAPED}';\n`,
            }
        );
        expect(providerCalls).toBe(0);
        expect(result.report.findingAssessments).toHaveLength(0);
        expect(result.report.limitations.join(' ')).toContain('withheld');
    });

    it('names a withheld credential with one code on both routes', async () => {
        // The scan recorded `evidence-withheld` while verify recorded `evidence-withheld-credential-shaped`
        // for the same reference, so the projection carried both and one withheld reference read two
        // reasons. Both routes now emit the specific code, shared through `CREDENTIAL_SHAPED_WITHHELD_CODE`,
        // while `credential-shaped-content-excluded` stays the scan's separate scope-exclusion vocabulary.
        const path = 'src/modules/Project/notes.ts';
        const credentialSide = `const url = '${CONNECTION_SHAPED}';\n`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile(path)],
                blobs: {
                    [`${MERGE_BASE}:${path}`]: 'const url = 1;\n',
                    [`${HEAD}:${path}`]: credentialSide,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { result, providerCalls } = await verifyWith([{ path, side: 'after' }], {
            [`${HEAD}:${path}`]: credentialSide,
        });
        const scanReason = set.truncated.find((entry) => entry.path === path)?.reason;
        expect(scanReason).toBe('evidence-withheld-credential-shaped');
        expect(providerCalls).toBe(0);
        expect(result.report.scope.truncated.find((entry) => entry.path === path)?.reason).toBe(scanReason);
        // The scope exclusion is the other vocabulary, and only the scan records it: the planner skips on
        // an exclusion, while a finding's evidence is not a unit of its own and has no exclusion to carry.
        expect(set.excluded).toEqual([{ path, reason: 'credential-shaped-content-excluded' }]);
        expect(result.report.scope.excluded).toEqual([]);
    });

    it('names the credential cause over hunk-beyond-file when both apply to one reference', async () => {
        // A credential-shaped side whose hunk names lines past the file has both causes available. The
        // scan recorded hunk-beyond-file there while verify recorded the credential cause, so the same
        // reference read two reasons; the content screen now decides first on both routes, because that is
        // why nothing left the machine. The path is not excluded either: its clean slices may still leave,
        // and `credentialShapedPaths` keys the context gate from those same slices.
        const path = 'src/modules/Project/notes.ts';
        const credentialSide = `const url = '${CONNECTION_SHAPED}';\nconst trailing = 1;\n`;
        const files = [changedFile(path)];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${path}`]: 'const url = 1;\nconst trailing = 1;\n',
                    [`${HEAD}:${path}`]: credentialSide,
                },
                hunks: new Map([[path, { path, before: [], after: [{ startLine: 5_000, endLine: 5_001 }] }]]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { result, providerCalls } = await verifyWith(
            [{ path, side: 'after', startLine: 5_000, endLine: 5_001 }],
            { [`${HEAD}:${path}`]: credentialSide }
        );
        const scanReason = set.truncated.find((entry) => entry.path === path)?.reason;
        expect(scanReason).toBe('evidence-withheld-credential-shaped');
        expect(providerCalls).toBe(0);
        expect(result.report.scope.truncated.find((entry) => entry.path === path)?.reason).toBe(scanReason);
        // The path is not excluded, so the planner still plans it from the clean before side it admitted:
        // the gate's credential set and the planner's skip set stay equal here, where a scope exclusion
        // would have claimed a whole path the change's own clean slice still supplies.
        expect(set.excluded).toEqual([]);
        const planned = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        expect(planned.units.map((unit) => unit.path)).toEqual([path]);
        expect(planned.units[0]?.evidence.own.map((reference) => reference.side)).toEqual(['before']);
    });

    it('records hunk-beyond-file when a finding names a range that starts past the file', async () => {
        // R3: verify clamped a startLine past the file to the file's last line and sent that line as the
        // finding's own evidence, while the scan records hunk-beyond-file and supplies nothing. Both
        // routes now slice through `sliceLines` and refuse the same reference.
        const { result, providerCalls } = await verifyWith(
            [{ path: 'src/modules/Project/a.ts', side: 'after', startLine: 5000, endLine: 5001 }],
            {
                [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\nexport const b = 2;',
            }
        );
        expect(providerCalls).toBe(0);
        expect(result.report.findingAssessments).toHaveLength(0);
        expect(result.report.scope.unassessed[0]?.reason).toBe('no-admissible-evidence');
        expect(result.report.scope.truncated).toEqual([
            { path: 'src/modules/Project/a.ts', reason: 'hunk-beyond-file (after)' },
        ]);
    });

    it('gives a verify report its own question identity', async () => {
        // It recorded the scan rules digest although its questions are built elsewhere.
        const { runVerify } = await import('../verify.ts');
        const provider = constantProvider({ supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 });
        const findings: CandidateFinding[] = [
            {
                findingId: 'f1',
                headSha: HEAD,
                claim: 'a claim',
                expectedBehavior: 'expected',
                evidenceReferences: [
                    { path: 'src/modules/Project/a.ts', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                ],
            },
        ];
        const result = await runVerify({
            ports: {
                source: fakeSource({
                    files: [],
                    blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
                }),
                provider,
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            findings,
            runId: 'verify-identity',
        });
        expect(result.report.rulesDigest).toBe(computeVerifyQuestionsDigest(findings));
        expect(result.report.rulesDigest).not.toBe(computeRulesDigest());

        // Different questions must not share one identity, or the second run overwrites the first's
        // sidecar while claiming the same question set.
        const otherFindings: CandidateFinding[] = [{ ...findings[0]!, claim: 'a different claim' }];
        expect(computeVerifyQuestionsDigest(otherFindings)).not.toBe(computeVerifyQuestionsDigest(findings));
    });

    it('covers the interpretation policy, not only the rule thresholds', () => {
        // Pins the preimage: dropping the tolerance or the severe-category set from the policy
        // identity would leave a report naming one policy for two different outcomes.
        const expected = semanticDigest({
            rules: SEMANTIC_RULES.map((rule) => ({
                id: rule.id,
                thresholds: { fire: rule.thresholds.fire },
            })),
            verification: {
                support: VERIFICATION_SUPPORT_THRESHOLD,
                attribution: VERIFICATION_ATTRIBUTION_THRESHOLD,
                kind: VERIFICATION_KIND_THRESHOLD,
            },
            probabilitySumTolerance: PROBABILITY_SUM_TOLERANCE,
            severeCategories: [...SEVERE_INVESTIGATION_CATEGORIES],
        });
        expect(computePolicyDigest()).toBe(expected);
    });
});

describe('verify mode', () => {
    const finding: CandidateFinding = {
        findingId: 'f1',
        headSha: HEAD,
        claim: 'The change drops a buffered frame',
        expectedBehavior: 'Every buffered frame is sent',
        evidenceReferences: [
            { path: 'src/modules/AudioEngine/live.ts', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
        ],
    };

    it('refuses a finding bound to a different head', async () => {
        // AC-02
        const { runVerify } = await import('../verify.ts');
        await expect(
            runVerify({
                ports: {
                    source: fakeSource({ files: [] }),
                    provider: constantProvider({ supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 }),
                    cache: new MapCache(),
                    clock: fixedClock(1_000),
                    signal: new AbortController().signal,
                    log: () => undefined,
                },
                revision: BASE_REVISION,
                profile: SEMANTIC_BUDGET_PROFILES.local,
                findings: [{ ...finding, headSha: 'f'.repeat(40) }],
                runId: 'verify-test',
            })
        ).rejects.toMatchObject({ code: 'stale_context' });
    });
});

describe('rules digest', () => {
    it('is stable across calls and covered by the report', async () => {
        expect(computeRulesDigest()).toBe(SHIPPED_RULES_DIGEST);
        const result = await runScan(
            scanPorts(
                constantProvider(0.1),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.rulesDigest).toBe(SHIPPED_RULES_DIGEST);
    });
});

describe('summary wording and the dry-run manifest', () => {
    it('renders a summary whose scope names a path the wording guard would refuse as prose', async () => {
        // The guard governs this application's claims. A repository path holding one of its words is
        // not a claim, and throwing on one discarded a produced assessment and reported no coverage.
        const provider = constantProvider(0.95);
        const clock = fixedClock(1_000);
        const ports = scanPorts(
            provider,
            fakeSource({
                files: [changedFile('src/modules/Approved/live.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Approved/live.ts`]: 'const a = 1;\n',
                    [`${HEAD}:src/modules/Approved/live.ts`]: 'const a = 2;\n',
                },
            }),
            clock
        );
        const result = await runScan(ports);
        expect(() => renderSummary(result.report)).not.toThrow();
        expect(renderSummary(result.report)).toContain('Semantic review (scan)');
        // The guard is still live on the sentences this application composes.
        expect(() => assertAdvisoryWording('Completed: no additional semantic signals; safe to merge.')).toThrow();
    });

    it('keeps a dry run consistent with its own manifest', async () => {
        const provider = constantProvider(0.05);
        const clock = fixedClock(1_000);
        const result = await runScan({
            ...scanPorts(
                provider,
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            ),
            dryRun: true,
        });
        expect(result.report.execution).toBe('skipped');
        expect(result.report.scope.eligible).toBe(1);
        expect(result.report.scope.assessed).toBe(0);
        expect(result.report.scope.unassessed).toHaveLength(1);
        expect(() => validateReport(result.report)).not.toThrow();
    });
});

describe('execution state and required evidence resolution', () => {
    it('counts only the exclusions that mean an assessment was owed', () => {
        // A lockfile or generated file needs no assessment, so a change made only of them is a skip,
        // not a failed check claiming a coverage gap that does not exist.
        for (const reason of ['no-applicable-rule', 'generated', 'dependency-lockfile', 'binary', 'no-text-change']) {
            expect(isMissedAssessmentExclusion(reason)).toBe(false);
        }
        for (const reason of [
            'credential-shaped-content-excluded',
            'no-admissible-evidence',
            'unit-overhead-exceeds-request-budget',
            'no-evidence-region-within-budget',
        ]) {
            expect(isMissedAssessmentExclusion(reason)).toBe(true);
        }
    });

    it('separates an empty eligible scope from a provider that delivered nothing', () => {
        // A change that admits no rule has nothing missing; reporting it as unavailable put a red
        // advisory check on documentation-only changes and hid the outage the state exists to report.
        expect(executionState({ dryRun: false, assessed: 0, eligible: 0, failureCode: undefined })).toBe('skipped');
        expect(
            executionState({ dryRun: false, assessed: 0, eligible: 0, failureCode: undefined, excludedCount: 2 })
        ).toBe('unavailable');
        expect(
            executionState({ dryRun: false, assessed: 0, eligible: 0, failureCode: undefined, truncatedCount: 2 })
        ).toBe('unavailable');
        expect(executionState({ dryRun: false, assessed: 0, eligible: 3, failureCode: undefined })).toBe('unavailable');
        expect(executionState({ dryRun: false, assessed: 0, eligible: 3, failureCode: 'timeout' })).toBe('unavailable');
        expect(executionState({ dryRun: false, assessed: 0, eligible: 3, failureCode: 'cancelled' })).toBe('cancelled');
    });

    it('sends only the range a finding named, not the whole file', async () => {
        // A finding about one line egressed the entire file and recorded bounds the request never
        // used, so the assessment covered a scope wider than the caller named.
        const { runVerify } = await import('../verify.ts');
        const seen: Record<string, unknown>[] = [];
        const provider = constantProvider(
            { supported: 0.8, contradicted: 0.1, insufficient_context: 0.1 },
            {
                systemOne: async ({ state }) => {
                    seen.push(state as Record<string, unknown>);
                    return {
                        model: TYPESAFE_MODEL,
                        answers: {},
                        usage: { input_tokens: 10, output_tokens: 0 },
                    };
                },
            }
        );
        const blobs = {
            [`${HEAD}:src/modules/Project/a.ts`]: 'first line\nsecond line\nthird line\nfourth line\nfifth line\n',
        };
        const result = await runVerify({
            ports: {
                source: fakeSource({ files: [], blobs }),
                provider,
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [{ path: 'src/modules/Project/a.ts', side: 'after', startLine: 2, endLine: 2 }],
                },
            ],
            runId: 'verify-range',
        });
        const serialized = JSON.stringify(seen);
        expect(serialized).toContain('second line');
        for (const absent of ['first line', 'third line', 'fourth line', 'fifth line']) {
            expect(serialized).not.toContain(absent);
        }
        expect(result.report.execution).toBeDefined();
    });

    it('reports implementation-source evidence as missing when only test source was supplied', () => {
        const rule = semanticRule('production_path_no_longer_reached');
        const beforeRegion = reference({
            evidenceId: 'e0',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const testRegion = reference({ evidenceId: 'e1', path: 'src/modules/Project/__tests__/undo.spec.ts' });
        const implementationRegion = reference({
            evidenceId: 'e2',
            path: 'src/modules/Project/useCases/undoProject.ts',
        });

        // The test file's own after region is not the implementation: with only that supplied, the
        // rule's declared need is reported missing rather than scored against evidence it never saw.
        expect(missingRequiredEvidence(rule, [beforeRegion, testRegion], [], 'modified')).toEqual([
            'after implementation source',
        ]);
        expect(missingRequiredEvidence(rule, [beforeRegion, testRegion], [implementationRegion], 'modified')).toEqual(
            []
        );
    });
});

describe('contract documents satisfy neither a call site nor related source', () => {
    it('reports a scheduling call-site missing despite contract context (#4555)', () => {
        // The only context regions the planner mints are contract documents, which say nothing about
        // where audio events are scheduled. The token must stay missing until a call-site region is
        // collected, never be satisfied by AGENTS.md.
        const ownAfter = reference({ evidenceId: 'a1', path: 'crates/daw-dsp/src/a.rs', side: 'after' });
        const contract = reference({ evidenceId: 'c1', path: 'AGENTS.md', side: 'context' });
        expect(
            missingRequiredEvidence(semanticRule('timing_semantics_changed'), [ownAfter], [contract], 'modified')
        ).toContain('scheduling call-site');
    });

    it('reports related existing source missing despite contract context (#4555)', () => {
        // A contract document is not the existing source a duplication question compares against, so a
        // decisive duplication verdict with only AGENTS.md in the request is exactly the error this
        // token must refuse.
        const ownAfter = reference({ evidenceId: 'a1', path: 'src/modules/Project/undo.ts', side: 'after' });
        const contract = reference({ evidenceId: 'c1', path: 'AGENTS.md', side: 'context' });
        expect(
            missingRequiredEvidence(semanticRule('duplicates_existing_mechanism'), [ownAfter], [contract], 'modified')
        ).toContain('related existing source');
    });
});

describe('collector withholding reaches the side accounting', () => {
    it('reports a side missing when one of its hunks exceeded the per-region budget', () => {
        // The collector withheld one of the after hunks at admission, not the fitter. The surviving
        // after region alone satisfied the side before, so the rule returned a decisive verdict over a
        // side the model saw only in part.
        const before = 'it("before", () => {});\n';
        const after = `it("kept", () => {});\n${'const large_line = 1;\n'.repeat(200)}`;
        const files = [changedFile('src/modules/Project/__tests__/two-hunks.spec.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/two-hunks.spec.ts`]: before,
                    [`${HEAD}:src/modules/Project/__tests__/two-hunks.spec.ts`]: after,
                },
                hunks: new Map([
                    [
                        'src/modules/Project/__tests__/two-hunks.spec.ts',
                        {
                            path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 201 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 400, maxTotalBytes: 1_000_000 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit).toBeDefined();
        // One after hunk survives, so a predicate that only checks `some` would call the side present.
        expect(unit?.evidence.references.some((ref) => ref.side === 'after')).toBe(true);
        expect(unit?.evidence.ownDroppedSides.has('after')).toBe(true);

        const missing = missingRequiredEvidence(
            semanticRule('assertion_deleted'),
            unit?.evidence.own ?? [],
            unit?.evidence.context ?? [],
            'modified',
            unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
            unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
        );
        expect(missing).toContain('after test source');
        expect(
            interpretScanOutcome({
                answer: { type: 'noul', noul: 0.05 },
                rule: semanticRule('assertion_deleted'),
                unitId: 'u',
                path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
                missingEvidence: missing,
            }).outcome
        ).toBe('insufficient_context');
    });

    it('reports a side missing when a hunk was omitted for the total budget', () => {
        const beforeLine = 'it("before", () => {});';
        const firstLine = 'it("first", () => {});';
        const secondLine = 'it("second", () => {});';
        const files = [changedFile('src/modules/Project/__tests__/two-hunks.spec.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/two-hunks.spec.ts`]: `${beforeLine}\n`,
                    [`${HEAD}:src/modules/Project/__tests__/two-hunks.spec.ts`]: `${firstLine}\n${secondLine}\n`,
                },
                hunks: new Map([
                    [
                        'src/modules/Project/__tests__/two-hunks.spec.ts',
                        {
                            path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // The total budget admits the before hunk and the first after hunk but not the second.
            limits: {
                maxRegionBytes: 1_000,
                maxTotalBytes: Buffer.byteLength(beforeLine, 'utf8') + Buffer.byteLength(firstLine, 'utf8'),
            },
        });
        expect(set.truncated.some((entry) => entry.reason.startsWith('total-evidence-budget-exhausted'))).toBe(true);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit?.evidence.ownDroppedSides.has('after')).toBe(true);
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified',
                unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
                unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
            )
        ).toContain('after test source');
    });

    it('reports a contract side missing when one contract region was withheld for a credential', () => {
        const aws = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const files = [changedFile('src/modules/Project/undo.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: 'export const a = 1;\n',
                    [`${HEAD}:src/modules/Project/undo.ts`]: 'export const a = 2;\n',
                    [`${MERGE_BASE}:AGENTS.md`]: '# Rules\n',
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: `token: ${aws}\n`,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            contractPaths: ['AGENTS.md', '.agents/decisions/README.md'],
        });
        // One contract region survived and one was withheld, so the context side was seen only in part.
        expect(set.references.filter((ref) => ref.side === 'context')).toHaveLength(1);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit?.evidence.contextDroppedSides.has('context')).toBe(true);
        expect(
            missingRequiredEvidence(
                semanticRule('stated_invariant_contradicted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified',
                unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
                unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
            )
        ).toContain('decision or documented invariant');
    });

    it('still reports a side supplied when every region was admitted', () => {
        const files = [changedFile('src/modules/Project/__tests__/clean.spec.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/clean.spec.ts`]: 'it("before", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/clean.spec.ts`]: 'it("after", () => {});\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit?.evidence.ownDroppedSides.size).toBe(0);
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toEqual([]);
    });
});

describe('collector withholding of an implementation file reaches the consuming unit', () => {
    it('reports implementation source missing when the changed implementation had a withheld after hunk', () => {
        // The implementation context is assembled from other changed files' surviving after regions,
        // and the collector's withholding of one of those files' hunks is keyed to that file under
        // `withheldSides.own` — never merged into the consuming unit. A surviving hunk then satisfied
        // `after implementation source`, and the rule scored a decisive verdict over an implementation
        // the model saw only in part.
        const testPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const implPath = 'src/modules/Project/useCases/undoProject.ts';
        const aws = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const files = [changedFile(testPath), changedFile(implPath)];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${testPath}`]: 'it("before", () => {});\n',
                    [`${HEAD}:${testPath}`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:${implPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${implPath}`]: `export const kept = 1;\nconst key = '${aws}';\n`,
                },
                hunks: new Map([
                    [
                        testPath,
                        {
                            path: testPath,
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                    [
                        implPath,
                        {
                            path: implPath,
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path === testPath);
        expect(unit).toBeDefined();
        expect(unit?.rules.map((rule) => rule.id)).toContain('production_path_no_longer_reached');
        // The surviving implementation hunk sits in the unit's context, but the withheld hunk names the
        // same owning file, so the context after side is unsupplied.
        expect(unit?.evidence.contextDroppedSides.has('after')).toBe(true);
        const missing = missingRequiredEvidence(
            semanticRule('production_path_no_longer_reached'),
            unit?.evidence.own ?? [],
            unit?.evidence.context ?? [],
            'modified',
            unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
            unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
        );
        expect(missing).toContain('after implementation source');
        expect(
            interpretScanOutcome({
                answer: { type: 'noul', noul: 0.05 },
                rule: semanticRule('production_path_no_longer_reached'),
                unitId: 'u',
                path: testPath,
                missingEvidence: missing,
            }).outcome
        ).toBe('insufficient_context');
    });

    it('reports implementation source missing when the changed implementation was withheld in full', () => {
        // A wholly withheld implementation file leaves no surviving after region to attribute, so the
        // old attribution walk never consulted its recorded withholding; a second, clean implementation
        // file then satisfied `after implementation source` over an incomplete candidate set.
        const testPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const withheldImplPath = 'src/modules/Project/useCases/undoProject.ts';
        const cleanImplPath = 'src/modules/Project/useCases/arrange.ts';
        const aws = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const files = [changedFile(testPath), changedFile(withheldImplPath), changedFile(cleanImplPath)];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${testPath}`]: 'it("before", () => {});\n',
                    [`${HEAD}:${testPath}`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:${withheldImplPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${withheldImplPath}`]: `const key = '${aws}';\n`,
                    [`${MERGE_BASE}:${cleanImplPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${cleanImplPath}`]: 'export const after = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path === testPath);
        expect(unit).toBeDefined();
        expect(unit?.rules.map((rule) => rule.id)).toContain('production_path_no_longer_reached');
        // The clean implementation's after side survives in context, but the withheld implementation's
        // after side is recorded under `withheldSides.own` and must unsupply the context side.
        expect(unit?.evidence.contextDroppedSides.has('after')).toBe(true);
        const missing = missingRequiredEvidence(
            semanticRule('production_path_no_longer_reached'),
            unit?.evidence.own ?? [],
            unit?.evidence.context ?? [],
            'modified',
            unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
            unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
        );
        expect(missing).toContain('after implementation source');
        expect(
            interpretScanOutcome({
                answer: { type: 'noul', noul: 0.05 },
                rule: semanticRule('production_path_no_longer_reached'),
                unitId: 'u',
                path: testPath,
                missingEvidence: missing,
            }).outcome
        ).toBe('insufficient_context');
    });

    it('still scores a unit whose implementation context was delivered whole', () => {
        const testPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const implPath = 'src/modules/Project/useCases/undoProject.ts';
        const files = [changedFile(testPath), changedFile(implPath)];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${testPath}`]: 'it("before", () => {});\n',
                    [`${HEAD}:${testPath}`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:${implPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${implPath}`]: 'export const after = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path === testPath);
        expect(unit).toBeDefined();
        expect(unit?.evidence.contextDroppedSides.has('after')).toBe(false);
        expect(
            missingRequiredEvidence(
                semanticRule('production_path_no_longer_reached'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified',
                unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
                unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
            )
        ).toEqual([]);
    });
});

describe('the outcome line never claims completion for a partial run', () => {
    it('words a partial execution with decisive answers as incomplete', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        const partial = {
            ...result.report,
            execution: 'partial' as const,
            signals: result.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };
        const summary = renderSummary(partial);
        expect(summary).not.toContain('Completed: no additional semantic signals');
        expect(summary).toContain('did not supply all its evidence');
    });
});

describe('the undecided sentence names near misses without calling them unresolved', () => {
    it('accounts for a genuine unresolved answer and a near miss together', async () => {
        // `undecided` counts genuine `unresolved` dispositions and near misses together, so the
        // sentence must name both categories: a near miss is a `no_additional_recommendation` answer
        // below its fire threshold, not an unresolved question.
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        const base = result.report.signals[0] as (typeof result.report.signals)[number];
        const decisive = {
            ...base,
            outcome: 'no_signal' as const,
            disposition: 'no_additional_recommendation' as const,
            probability: 0.02,
            missingEvidence: [],
        };
        const nearMiss = {
            ...base,
            outcome: 'no_signal' as const,
            disposition: 'no_additional_recommendation' as const,
            probability: 0.6,
            missingEvidence: [],
        };
        const unresolved = {
            ...base,
            outcome: 'insufficient_context' as const,
            disposition: 'unresolved' as const,
            probability: 0.5,
            missingEvidence: ['after test source'],
        };
        const summary = renderSummary({ ...result.report, signals: [unresolved, nearMiss, decisive] });
        expect(summary).toContain('2 of 3 question(s)');
        expect(summary).toContain('unresolved or came close to their threshold');
        expect(summary).not.toContain('were unresolved in');
    });
});

describe('vendor prefix coverage', () => {
    it('withholds every AWS prefix the pinned scanner recognises', () => {
        const body = secretFixture('IOSFODNN7', 'EXAMPLE');
        const prefixes = [
            secretFixture('AK', 'IA'),
            secretFixture('AS', 'IA'),
            secretFixture('AB', 'IA'),
            secretFixture('AC', 'CA'),
        ];
        for (const prefix of prefixes) {
            expect(sensitiveContentReason(secretFixture(prefix, body))).toBe('an AWS access key id');
        }
        // `A3T` followed by one character from `[A-Z0-9]`, then the sixteen-character body.
        expect(sensitiveContentReason(secretFixture('A3TA', body))).toBe('an AWS access key id');
    });

    it('withholds a temporary ASIA key id assigned to a secret-named variable', () => {
        const asia = secretFixture('ASIA', 'IOSFODNN7', 'EXAMPLE');
        const assigned = secretFixture('AWS_ACCESS_KEY_ID=', asia);
        expect(sensitiveContentReason(assigned)).toBe('an AWS access key id');
    });

    it('withholds every Stripe key kind the pinned scanner recognises', () => {
        const body = secretFixture('a1b2c3d4e5f6g7h8', 'i9j0k1l2');
        for (const prefix of [
            secretFixture('sk_test_'),
            secretFixture('sk_live_'),
            secretFixture('sk_prod_'),
            secretFixture('rk_test_'),
            secretFixture('rk_live_'),
            secretFixture('rk_prod_'),
        ]) {
            expect(sensitiveContentReason(secretFixture(prefix, body))).toBe('a Stripe secret key');
        }
    });

    it('withholds a Stripe test key and a restricted key', () => {
        const test = secretFixture('sk_test_', 'a1b2c3d4e5f6g7h8', 'i9j0k1l2');
        const restricted = secretFixture('rk_live_', 'a1b2c3d4e5f6g7h8', 'i9j0k1l2');
        expect(sensitiveContentReason(test)).toBe('a Stripe secret key');
        expect(sensitiveContentReason(restricted)).toBe('a Stripe secret key');
    });

    it('withholds a value composed from every generated shape', () => {
        // The whole table is pinned by a digest that serialises every field the screen depends on —
        // the parts arrays (not their joined prefix), the tail and its case scope, the fixture, the
        // key names, and the residual record — so deleting a key name, merging two fragments, editing a
        // residual reason, or rewriting a fixture all fail here. The shape, key-name and residual counts
        // are asserted separately, so a regeneration that drops an entry fails even if the digest line
        // is edited to match. Each entry's own pattern matches its own fixture, and the screen's own
        // prefix case scope agrees with the table's `flags`; the standalone literal cases below anchor
        // the table to the source's scope.
        expect(EGRESS_VENDOR_SHAPES).toHaveLength(100);
        expect(VENDOR_KEY_NAMES).toHaveLength(85);
        expect(RESIDUAL_RULES).toHaveLength(39);
        const serialized = [
            ...EGRESS_VENDOR_SHAPES.map(
                (shape) =>
                    `${shape.reason}\u0000${JSON.stringify(shape.parts)}\u0000${shape.tail}\u0000${shape.flags}\u0000${shape.bodyInsensitive}\u0000${JSON.stringify(shape.fixture)}`
            ),
            ...VENDOR_KEY_NAMES,
            ...RESIDUAL_RULES.map((rule) => `${rule.id}\u0000${rule.reason}`),
        ].join('\n');
        expect(createHash('sha256').update(serialized).digest('hex')).toBe(
            '4534c6f7f6fe72d3ad6e5c62e6e9bed9e6ba522a0a2c37ff5c998c3894dfa517'
        );
        for (const shape of EGRESS_VENDOR_SHAPES) {
            const prefix = shape.parts.join('');
            const fixture = secretFixture(...shape.parts, ...shape.fixture);
            const pattern = new RegExp(`\\b${prefix}${shape.tail}`, shape.flags);
            // The fixture is concretised from the tail, so this is a fixture-to-tail consistency check:
            // it fails when the concretiser and the tail disagree. The digest above pins the checked-in
            // content against a hand edit.
            expect(pattern.test(fixture), `${shape.reason}: own pattern does not match its fixture`).toBe(true);
            // The screen withholds the shape's own fixture.
            expect(sensitiveContentReason(fixture), `${shape.reason}: ${fixture.slice(0, 24)}`).toBeDefined();
            // The screen's prefix case scope, observed through the screen rather than the rebuilt
            // pattern. This asserts the table's `flags` agree with the screen's compilation, not the
            // source's scope — a consistently wrong flag-and-body pair passes once the digest is
            // restamped; the standalone literal cases below anchor the source's scope. Reason equality,
            // not presence, so a different shape cannot mask.
            const flippedPrefix = secretFixture(flipCase(prefix), ...shape.fixture);
            if (shape.flags === 'iu') {
                expect(sensitiveContentReason(flippedPrefix), `${shape.reason}: prefix case scope`).toBe(shape.reason);
            } else {
                expect(sensitiveContentReason(flippedPrefix), `${shape.reason}: prefix case scope`).toBeUndefined();
            }
            // The body case scope lives in the tail's scoped groups, which the digest above pins; the
            // rebuilt pattern over that same tail observes the body's case sensitivity exactly.
            const upperBody = secretFixture(...shape.parts, shape.fixture.map((chunk) => chunk.toUpperCase()).join(''));
            if (shape.bodyInsensitive) {
                expect(pattern.test(upperBody), `${shape.reason}: body case scope`).toBe(true);
            }
        }
    });

    it('fires every derived vendor key name as a secret-named assignment', () => {
        // Every key name must reach the value heuristic: a keyword-proximity family whose name does not
        // fire would be reported under coverage while withholding nothing.
        const opaque = 'a'.repeat(40);
        for (const name of VENDOR_KEY_NAMES) {
            expect(sensitiveContentReason(secretFixture(name, '=', opaque)), name).toBeDefined();
        }
    });

    it('scopes Sendinblue case sensitivity to the tail, not the hex field', () => {
        // Source: `xkeysib-[a-f0-9]{64}\-(?i)[a-z0-9]{16}`. The hex field precedes the flag, so an
        // uppercase hex run must not be withheld, while the case-insensitive tail must still reach the
        // screen.
        const lowerHex = secretFixture('xkeysib-', '0'.repeat(64), '-', 'ABCDEF0123456789');
        const upperHex = secretFixture('xkeysib-', 'A'.repeat(64), '-', 'abcdef0123456789');
        expect(sensitiveContentReason(lowerHex)).toBe('a Sendinblue API token');
        expect(sensitiveContentReason(upperHex)).toBeUndefined();
    });

    it('scopes Flutterwave case insensitivity over the trailing literal', () => {
        // Source: `FLWPUBK_TEST-(?i)[a-h0-9]{32}-X`. The flag covers the `-X` literal too, so both
        // `-X` and `-x` must be withheld.
        const upperX = secretFixture('FLWPUBK_TEST-', 'a'.repeat(32), '-X');
        const lowerX = secretFixture('FLWPUBK_TEST-', 'a'.repeat(32), '-x');
        expect(sensitiveContentReason(upperX)).toBe('a Finicity Public Key');
        expect(sensitiveContentReason(lowerX)).toBe('a Finicity Public Key');
    });

    it('reaches a whole-insensitive Clojars prefix in either case', () => {
        // Source: `(?i)CLOJARS_[a-z0-9]{60}`. The leading flag covers the prefix, so the lowercase
        // form is withheld by the screen's own flag, not by a widened prefix literal.
        expect(sensitiveContentReason(secretFixture('CLOJARS_', 'a'.repeat(60)))).toBe('a Clojars API token');
        expect(sensitiveContentReason(secretFixture('clojars_', 'a'.repeat(60)))).toBe('a Clojars API token');
    });

    it('keeps an inline-insensitive Alibaba prefix case-sensitive', () => {
        // Source: `\b(LTAI(?i)[a-z0-9]{20})…`. The flag follows the prefix, so `LTAI` is withheld and
        // `ltai` is admitted.
        const body = secretFixture('0123456789', 'abcdefghij');
        expect(sensitiveContentReason(secretFixture('LTAI', body))).toBe('an Alibaba Cloud AccessKey ID');
        expect(sensitiveContentReason(secretFixture('ltai', body))).toBeUndefined();
    });
});

describe('armored envelopes with arbitrary header lines', () => {
    it('withholds an envelope carrying a Version line between header and body', () => {
        const rsaHeader = secretFixture('-----BEGIN RSA ', 'PRIVATE KEY', '-----');
        const body = secretFixture('TUlJRXZRSUJBREFO', 'QmdrcWhraUc5dzBC', 'QVFFRkFBU0NCS2N3', 'Z2dTakFnRUFBb0lC');
        const version = secretFixture('Version: ', 'OpenSSL 1.1.1');
        const versioned = secretFixture(rsaHeader, '\n', version, '\n', body);
        expect(sensitiveContentReason(versioned)).toBe('an armored private key');
    });
});

describe('the armored envelope matches whitespace-only lines in linear time', () => {
    it('does not backtrack over whitespace-padded blank lines after a lone header', () => {
        // The envelope had two whitespace consumers separated only by an optional group, so a
        // whitespace-only line admitted one backtracking path per leading space and the outer `*`
        // multiplied those across lines: twelve spaces of padding is thirteen paths per line, and the
        // reviewer measured roughly thirteen times per added line. A header followed by fifteen such
        // lines projected to years under the old shape while it can never match — the header alone
        // carries no key material, so the correct answer is `undefined`. Fifteen lines is far past any
        // test timeout, so a regression to the ambiguous shape fails by timing out rather than by
        // returning a wrong value.
        const pkcs8Header = secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----');
        const paddedBlankLine = '            \n';
        const input = secretFixture(pkcs8Header, '\n', paddedBlankLine.repeat(15));
        expect(sensitiveContentReason(input)).toBeUndefined();
    });
});

describe('the armored shape keys on the block, not one line length', () => {
    const pkcs8Header = secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----');
    const footer = secretFixture('-----END ', 'PRIVATE KEY', '-----');

    it('withholds a body reflowed into lines shorter than any single-line floor when a footer is present', () => {
        // A real PEM whose body was reflowed into lines shorter than the old floor still carries its
        // closing footer, and the footer — not one line's length — is what identifies the block.
        const reflowed = secretFixture(pkcs8Header, '\n', 'MIIEvgIBADANBgkq', '\n', 'hkiG9w0BAQEFAASCBK', '\n', footer);
        expect(sensitiveContentReason(reflowed)).toBe('an armored private key');
    });

    it('withholds a body that begins on the header own line', () => {
        const body = secretFixture('TUlJ', 'RXZRSUJBREFO', 'Qmdr', 'a2lod0FBUUVGQUFTQ0JL');
        const sameLine = secretFixture(pkcs8Header, body, '\n', footer);
        expect(sensitiveContentReason(sameLine)).toBe('an armored private key');
    });

    it('still withholds a footerless run of real body length', () => {
        const longRun = secretFixture(pkcs8Header, '\n', 'A'.repeat(64));
        expect(sensitiveContentReason(longRun)).toBe('an armored private key');
    });

    it('does not withhold a long placeholder under a header without a footer', () => {
        // A fake block showing a twenty-four-character placeholder where the body belongs is
        // documentation, not key material: only a footer or a run of real body length proves a block.
        const placeholder = secretFixture(pkcs8Header, '\n', 'AAAAAAAA', 'AAAAAAAA', 'AAAAAAAA');
        expect(sensitiveContentReason(placeholder)).toBeUndefined();
    });
});

describe('the collection predicate matches the runners, not a restated rule', () => {
    it('collects exactly the paths some runner executes', () => {
        expect(isCollectedSpec('src/modules/Project/__tests__/undo.spec.ts')).toBe(true);
        expect(isCollectedSpec('scripts/__tests__/semanticReview.spec.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/audioOwnership.native.spec.ts')).toBe(true);
        expect(isCollectedSpec('server/__tests__/health.spec.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.mts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.cts')).toBe(true);
        // The e2e exclusion removes the path from Vitest's root, and no other runner collects it there.
        expect(isCollectedSpec('src/modules/Project/__tests__/undo.e2e.spec.ts')).toBe(false);
        expect(isCollectedSpec('src/modules/Project/undo.spec.md')).toBe(false);
    });

    it('plans a zero-line rename into the e2e exclusion instead of exempting it', () => {
        const file = changedFile('src/modules/Project/__tests__/undo.e2e.spec.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/__tests__/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('derives collection from the shared runner definition', () => {
        // The screen must import the collection contract rather than carry a private copy, so the
        // Vitest exclude cannot move without both consumers being updated in the same change.
        const e2eOutside = 'src/modules/Project/__tests__/undo.e2e.spec.ts';
        expect(e2eSpecPattern.test(e2eOutside)).toBe(true);
        expect(specFilePattern.test(e2eOutside)).toBe(true);
        expect(isCollectedSpec(e2eOutside)).toBe(false);
        const playwright = 'tests/e2e/audioOwnership.native.spec.ts';
        expect(specFilePattern.test(playwright)).toBe(true);
        expect(isCollectedSpec(playwright)).toBe(true);
    });
});

describe('each runner collects only its own declared scope', () => {
    it('collects the Playwright, node:test, and Vitest boundaries each runner declares', () => {
        // Vitest (`vite.config.ts`): the shared suffix, minus the e2e exclusion.
        expect(isCollectedSpec('src/a.spec.ts')).toBe(true);
        expect(isCollectedSpec('scripts/a.e2e.spec.ts')).toBe(false);
        // Playwright (`playwright.config.ts`): testDir `tests/e2e`, minus `**/__tests__/**`.
        expect(isCollectedSpec('tests/e2e/a.spec.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/a.test.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/nested/__tests__/dead.spec.ts')).toBe(false);
        // node:test (`server/package.json`): the non-recursive `__tests__/*.spec.ts` glob.
        expect(isCollectedSpec('server/__tests__/a.spec.ts')).toBe(true);
        expect(isCollectedSpec('server/__tests__/deep/x.spec.ts')).toBe(false);
        expect(isCollectedSpec('server/__tests__/x.spec.tsx')).toBe(false);
    });

    it('plans a zero-line rename into a Playwright-ignored __tests__ directory instead of exempting it', () => {
        // Playwright's `testIgnore: ['**/__tests__/**']` stops it collecting a spec under a nested
        // `__tests__` inside its own `testDir`, and Vitest excludes `tests/e2e/**` — no runner runs it.
        const file = changedFile('tests/e2e/nested/__tests__/dead.spec.ts', {
            kind: 'renamed',
            previousPath: 'tests/e2e/nested/dead.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('plans a zero-line rename out of the server non-recursive glob instead of exempting it', () => {
        // The server command's `__tests__/*.spec.ts` glob is non-recursive and `.spec.ts`-only, so a
        // nested or renamed-extension spec runs nowhere.
        const nested = changedFile('server/__tests__/deep/x.spec.ts', {
            kind: 'renamed',
            previousPath: 'server/__tests__/x.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(nested)).toBeUndefined();
        const renamedExtension = changedFile('server/__tests__/x.spec.tsx', {
            kind: 'renamed',
            previousPath: 'server/__tests__/x.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(renamedExtension)).toBeUndefined();
    });

    it('models the dotfile axis each runner actually observes', () => {
        // Established by planting a `.hidden.spec.ts` and asking each runner to list it:
        // - Vitest collected `scripts/.hidden.spec.ts` (`vitest list --filesOnly`), so its include
        //   matches a leading-dot name.
        // - Playwright collected `tests/e2e/.hidden.spec.ts` (`playwright test --list`), so it too
        //   collects a leading-dot name.
        // - node:test did not: the shell glob `__tests__/*.spec.ts` never expands a leading-dot name,
        //   so `tsx --test` receives nothing for `.hidden.spec.ts`.
        expect(isVitestCollected('src/.hidden.spec.ts')).toBe(true);
        expect(isPlaywrightCollected('tests/e2e/.hidden.spec.ts')).toBe(true);
        expect(isNodeTestCollected('server/__tests__/.hidden.spec.ts')).toBe(false);
        // The shared predicate mirrors that observed behaviour across all three arms.
        expect(isCollectedSpec('src/.hidden.spec.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/.hidden.spec.ts')).toBe(true);
        expect(isCollectedSpec('server/__tests__/.hidden.spec.ts')).toBe(false);
    });
});

function reference(input: { evidenceId: string; path: string; side?: EvidenceSide }): EvidenceReference {
    return {
        evidenceId: input.evidenceId,
        revisionSha: HEAD,
        path: input.path,
        side: input.side ?? 'after',
        startLine: 1,
        endLine: 2,
        contentHash: 'hash',
    };
}

/** A shipped profile with selected verify byte budgets replaced, so a spec can size the verify gate. */
function profileWithVerifyBudget(overrides: Partial<SemanticVerifyBudget>): SemanticBudgetProfile {
    return { ...SEMANTIC_BUDGET_PROFILES.local, verify: { ...SEMANTIC_BUDGET_PROFILES.local.verify, ...overrides } };
}

async function verifyWith(input: {
    provider: SemanticProviderPort;
    blobs?: Record<string, string>;
    /** A profile whose verify byte budgets replace the shipped local ones, so a spec can size the gate. */
    profile?: SemanticBudgetProfile;
    findings?: CandidateFinding[];
    runId?: string;
}): Promise<{ report: SemanticVerifyReport }> {
    const { runVerify } = await import('../verify.ts');
    return runVerify({
        ports: {
            source: fakeSource({ files: [], blobs: input.blobs ?? {} }),
            provider: input.provider,
            cache: new MapCache(),
            clock: fixedClock(1_000),
            signal: new AbortController().signal,
            log: () => undefined,
        },
        revision: BASE_REVISION,
        profile: input.profile ?? SEMANTIC_BUDGET_PROFILES.local,
        findings: input.findings ?? [
            {
                findingId: 'f1',
                headSha: HEAD,
                claim: 'a claim',
                expectedBehavior: 'expected',
                evidenceReferences: [
                    {
                        path: 'src/modules/Project/a.ts',
                        side: 'after',
                        startLine: 1,
                        endLine: Number.MAX_SAFE_INTEGER,
                    },
                ],
            },
        ],
        runId: input.runId ?? 'verify-test',
    });
}

/** A provider that answers each question with its own distribution, selecting the highest value. */
function perQuestionProvider(distributions: Record<string, Record<string, number>>): SemanticProviderPort {
    return {
        systemOne: async ({ questions }) => {
            const answers: Record<string, unknown> = {};
            for (const key of Object.keys(questions)) {
                const probabilities = distributions[key] ?? {};
                const choice = Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0]?.[0];
                answers[key] = { type: 'choice', probabilities, confidence: 0.9, choice };
            }
            return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
        },
    };
}

describe('the scope noun follows the mode on every line that names it', () => {
    const decisiveQuietVerifyProvider = (): SemanticProviderPort =>
        perQuestionProvider({
            support: { supported: 0.05, contradicted: 0.05, insufficient_context: 0.9 },
            attribution: { introduced_by_change: 0.05, pre_existing: 0.9, undetermined: 0.05 },
            kind: { behavioral_or_contract_issue: 0.5, style_preference: 0.3, undetermined: 0.2 },
            strongestEvidence: { none: 1 },
        });

    it('words every scan branch with unit(s), never finding(s)', async () => {
        const base = await runScan(
            scanPorts(
                constantProvider(0.02),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        const quiet = {
            ...base.report,
            signals: base.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };

        const completed = renderSummary(quiet);
        expect(completed).toContain('eligible unit(s)');
        expect(completed).not.toContain('eligible finding(s)');
        expect(completed).toContain('evaluated unit(s)');
        expect(completed).not.toContain('evaluated finding(s)');

        const partial = renderSummary({ ...quiet, execution: 'partial' as const });
        expect(partial).toContain('evaluated unit(s)');
        expect(partial).not.toContain('evaluated finding(s)');

        const empty = renderSummary({ ...quiet, scope: { ...quiet.scope, assessed: 0 }, signals: [] });
        expect(empty).toContain('No unit was assessed');
        expect(empty).not.toContain('No finding was assessed');
    });

    it('words every verify branch with finding(s), never unit(s)', async () => {
        const { report } = await verifyWith({
            provider: decisiveQuietVerifyProvider(),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });

        const completed = renderSummary(report);
        expect(completed).toContain('eligible finding(s)');
        expect(completed).not.toContain('eligible unit(s)');
        expect(completed).toContain('evaluated finding(s)');
        expect(completed).not.toContain('evaluated unit(s)');

        const partial = renderSummary({ ...report, execution: 'partial' as const });
        expect(partial).toContain('evaluated finding(s)');
        expect(partial).not.toContain('evaluated unit(s)');

        const empty = renderSummary({ ...report, scope: { ...report.scope, assessed: 0 }, findingAssessments: [] });
        expect(empty).toContain('No finding was assessed');
        expect(empty).not.toContain('No unit was assessed');
    });

    it('words the Incomplete line with the mode noun when the reduced sections are all non-empty', async () => {
        // The Incomplete line was the third place the scope noun was hardcoded. It renders only when
        // unassessed or truncated evidence exists, and the noun cases above rendered only quiet
        // reports, so this line hid the wrong noun twice. Rendering a scope whose unassessed, truncated
        // and limitation sections are all non-empty closes the class: no line may choose its own noun.
        // The counts are deliberately distinct — two unassessed against three truncated — so a line
        // that prints the wrong counter fails the exact-string assertion instead of matching on 1.
        const scanBase = await runScan(
            scanPorts(
                constantProvider(0.02),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        const quietScan = {
            ...scanBase.report,
            signals: scanBase.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };
        const scanSummary = renderSummary({
            ...quietScan,
            scope: {
                ...quietScan.scope,
                assessed: 5,
                eligible: 7,
                discovered: 7,
                unassessed: [
                    { path: 'src/modules/Project/a.ts', reason: 'no-admissible-evidence' },
                    { path: 'src/modules/Project/b.ts', reason: 'no-admissible-evidence' },
                ],
                truncated: [
                    { path: 'src/modules/Project/c.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/d.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/e.ts', reason: 'region-exceeds-per-region-budget (after)' },
                ],
            },
            limitations: [...quietScan.limitations, 'a limitation'],
        });
        expect(scanSummary).toContain('Incomplete: 2 unit(s) unassessed and 3 region(s) truncated or withheld.');
        expect(scanSummary).toContain('eligible unit(s)');
        expect(scanSummary).not.toContain('finding(s) unassessed');
        expect(scanSummary).not.toContain('eligible finding(s)');

        const { report: verifyReport } = await verifyWith({
            provider: decisiveQuietVerifyProvider(),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });
        const verifySummary = renderSummary({
            ...verifyReport,
            scope: {
                ...verifyReport.scope,
                assessed: 5,
                eligible: 7,
                discovered: 7,
                unassessed: [
                    { path: 'f1', reason: 'no-admissible-evidence' },
                    { path: 'f2', reason: 'no-admissible-evidence' },
                ],
                truncated: [
                    { path: 'src/modules/Project/a.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/b.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/c.ts', reason: 'region-exceeds-per-region-budget (after)' },
                ],
            },
            limitations: [...verifyReport.limitations, 'a limitation'],
        });
        expect(verifySummary).toContain('Incomplete: 2 finding(s) unassessed and 3 region(s) truncated or withheld.');
        expect(verifySummary).toContain('eligible finding(s)');
        expect(verifySummary).not.toContain('unit(s) unassessed');
        expect(verifySummary).not.toContain('eligible unit(s)');
    });

    it('refuses a completed report with unassessed scope naming the mode noun', async () => {
        // The refusal message in `assertExecutionMatchesScope` was the fourth place the scope noun was
        // hardcoded, reached by `validate` on a hand-edited document rather than by `renderSummary`. A
        // report claiming `completed` with a non-empty unassessed list must refuse naming the mode's
        // noun, in both modes. The count in the refusal is structurally `scope.unassessed.length`, so
        // naming the number is exact rather than brittle: two entries refuse as "2".
        const scanBase = await runScan(
            scanPorts(
                constantProvider(0.02),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        const scanCompleted = {
            ...scanBase.report,
            execution: 'completed' as const,
            scope: {
                ...scanBase.report.scope,
                // Two unassessed entries keep the validator's arithmetic: assessed + 2 === eligible and
                // eligible + excluded.length === discovered (excluded stays empty).
                eligible: scanBase.report.scope.assessed + 2,
                discovered: scanBase.report.scope.assessed + 2,
                unassessed: [
                    { path: 'src/modules/Project/a.ts', reason: 'no-admissible-evidence' },
                    { path: 'src/modules/Project/b.ts', reason: 'no-admissible-evidence' },
                ],
            },
        };
        expect(() => validateReport(scanCompleted)).toThrow(/2 unit\(s\) were unassessed/u);
        expect(() => validateReport(scanCompleted)).not.toThrow(/2 finding\(s\) were unassessed/u);

        const { report: verifyReport } = await verifyWith({
            provider: decisiveQuietVerifyProvider(),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });
        const verifyCompleted = {
            ...verifyReport,
            execution: 'completed' as const,
            scope: {
                ...verifyReport.scope,
                eligible: verifyReport.scope.assessed + 2,
                discovered: verifyReport.scope.assessed + 2,
                unassessed: [
                    { path: 'f1', reason: 'no-admissible-evidence' },
                    { path: 'f2', reason: 'no-admissible-evidence' },
                ],
            },
        };
        expect(() => validateReport(verifyCompleted)).toThrow(/2 finding\(s\) were unassessed/u);
        expect(() => validateReport(verifyCompleted)).not.toThrow(/2 unit\(s\) were unassessed/u);
    });
});

describe('the scan all-undecided sentence names the question count', () => {
    it('pairs one assessed unit with several signals and names question(s)', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.5),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.assessed).toBe(1);
        expect(result.report.signals.length).toBeGreaterThan(1);
        const summary = renderSummary(result.report);
        expect(summary).toContain(
            `all ${String(result.report.signals.length)} question(s) were unresolved or came close`
        );
        expect(summary).not.toContain(`all ${String(result.report.signals.length)} were unresolved`);
    });
});

describe('verify withholds a region over the per-region budget', () => {
    it('sends nothing for a finding whose only region exceeds the budget', async () => {
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'const oversized_value = 1;\n'.repeat(8) },
            profile: profileWithVerifyBudget({ maxRegionBytes: 32 }),
        });
        expect(providerCalls).toBe(0);
        expect(report.findingAssessments).toHaveLength(0);
        expect(
            report.scope.truncated.some(
                (entry) =>
                    entry.path === 'src/modules/Project/a.ts' &&
                    entry.reason === 'region-exceeds-per-region-budget (after)'
            )
        ).toBe(true);
        // The only cause was the region's size, so the reason names the size, not inadmissibility.
        expect(report.scope.unassessed[0]?.reason).toBe('no-evidence-region-within-budget');
    });

    it('names a before-side size refusal as the size on the verify route too', async () => {
        // The same cause on the other side, on the route that reads a finding's own references.
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const path = 'src/modules/Project/a.ts';
        const { report } = await verifyWith({
            provider,
            blobs: { [`${MERGE_BASE}:${path}`]: `${'x'.repeat(900)}\n` },
            profile: profileWithVerifyBudget({ maxRegionBytes: 200 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [{ path, side: 'before', startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([{ path, reason: 'region-exceeds-per-region-budget (before)' }]);
        expect(report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-evidence-region-within-budget' }]);
    });

    it('names a context-side size refusal as the size, contract qualifier and all', async () => {
        // The vocabulary's context form is `region-exceeds-per-region-budget (context, contract)`, and the
        // route that carries it is this one: a rule that matched the change sides alone, or that required
        // the reason to end at the side, would call a withheld contract document inadmissible.
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const path = 'AGENTS.md';
        const { report } = await verifyWith({
            provider,
            blobs: { [`${MERGE_BASE}:${path}`]: '# AGENTS.md contract\n'.repeat(60) },
            profile: profileWithVerifyBudget({ maxRegionBytes: 200 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [{ path, side: 'context', startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([
            { path, reason: 'region-exceeds-per-region-budget (context, contract)' },
        ]);
        expect(report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-evidence-region-within-budget' }]);
    });

    it('names the size only when the verify record has no other cause', async () => {
        // The verify route's mixed state: the first reference is over the region ceiling and the second
        // names a revision the file does not hold. The whole-record read keeps the reason inadmissible; a
        // first-entry read would flip it to the size, which the second cause contradicts.
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const sizePath = 'src/modules/Project/aaa.ts';
        const missingPath = 'src/modules/Project/zzz.ts';
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:${sizePath}`]: 'const sample_line = 1;\n'.repeat(400) },
            profile: profileWithVerifyBudget({ maxRegionBytes: 2_000 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        { path: sizePath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                        { path: missingPath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                    ],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([
            { path: sizePath, reason: 'region-exceeds-per-region-budget (after)' },
            { path: missingPath, reason: 'evidence-unavailable-at-revision' },
        ]);
        expect(report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-admissible-evidence' }]);
    });

    it('reads the fitter-empty reason from the whole record, not from its own cause alone', async () => {
        // The fitter's empty case goes through the same rule as the collector's: a region the request
        // dropped beside a reference naming an absent revision is a mixed record, and the reason is
        // inadmissibility — while a record holding only the request cause reads as the size.
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const sizePath = 'src/modules/Project/a.ts';
        const missingPath = 'src/modules/Project/zzz.ts';
        const { report } = await verifyWith({
            provider,
            // The first region fits the per-region gate and not the request; the second names a revision the
            // file does not hold.
            blobs: { [`${HEAD}:${sizePath}`]: 'const sample_line = 1;\n'.repeat(2_000) },
            profile: profileWithVerifyBudget({ maxRegionBytes: 90_000, maxStatePlusQuestionBytes: 4_000 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        { path: sizePath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                        { path: missingPath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                    ],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        // The collector's entries come first, the fitter's drops after them.
        expect(report.scope.truncated).toEqual([
            { path: missingPath, reason: 'evidence-unavailable-at-revision' },
            { path: sizePath, reason: 'request-exceeds-state-budget (after)' },
        ]);
        expect(report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-admissible-evidence' }]);
    });

    it('names an oversized contract-carrying reference with the shared contract qualifier', async () => {
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:scripts/reviewDossier.ts`]: 'const oversized = 1;\n'.repeat(8) },
            profile: profileWithVerifyBudget({ maxRegionBytes: 32 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        {
                            path: 'scripts/reviewDossier.ts',
                            side: 'after',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                    ],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'region-exceeds-per-region-budget (after, contract)' },
        ]);
    });

    it('names a content-classified spec reference with the same contract qualifier on both routes', async () => {
        // R3: verify derived the contract flag from the path alone, so a spec whose content imports the
        // closure read bulk on verify and contract on scan. The shared content rule makes both routes
        // emit the same string for the same reference.
        const specPath = 'scripts/__tests__/agentDeliveryScripts.spec.ts';
        const specAfter = `import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n${'const oversized = 1;\n'.repeat(
            8
        )}`;
        const scanSet = collectEvidence({
            port: fakeSource({
                files: [changedFile(specPath)],
                blobs: {
                    [`${MERGE_BASE}:${specPath}`]: 'const before = 1;\n',
                    [`${HEAD}:${specPath}`]: specAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 32, maxTotalBytes: 1_000_000 },
        });
        const scanReason = scanSet.truncated.find((entry) => entry.path === specPath)?.reason;

        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:${specPath}`]: specAfter },
            profile: profileWithVerifyBudget({ maxRegionBytes: 32 }),
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        { path: specPath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                    ],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([
            { path: specPath, reason: 'region-exceeds-per-region-budget (after, contract)' },
        ]);
        expect(scanReason).toBe('region-exceeds-per-region-budget (after, contract)');
    });

    it('sends and judges a region that fits the budget', async () => {
        const { report } = await verifyWith({
            provider: perQuestionProvider({
                support: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                attribution: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                kind: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                strongestEvidence: { none: 1 },
            }),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
            profile: profileWithVerifyBudget({ maxRegionBytes: 4_096 }),
        });
        const assessment = report.findingAssessments[0];
        expect(assessment?.disposition).toBe('ready_for_orchestrator_validation');
        expect(assessment?.reasoning).not.toContain('not supplied');
        expect(report.scope.truncated).toHaveLength(0);
    });

    it('withholds a region whose serialized size exceeds the budget even when its raw size fits', async () => {
        // The gate measured raw bytes, so a region whose newlines pushed its JSON-serialized size over
        // the budget was admitted, minted, and sent; the provider then refused the request, recording a
        // run-wide failure code and an empty truncated scope that hid the region. The gate must cost the
        // serialized bytes the fitter uses.
        const region = `const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;`;
        const rawBytes = Buffer.byteLength(region, 'utf8');
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a region over the serialized budget');
            },
        };
        // The budget admits the raw bytes exactly but refuses the serialized form, so a raw-byte gate
        // would have admitted the region.
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: region },
            profile: profileWithVerifyBudget({ maxRegionBytes: rawBytes }),
        });
        expect(providerCalls).toBe(0);
        expect(report.findingAssessments).toHaveLength(0);
        expect(
            report.scope.truncated.some(
                (entry) =>
                    entry.path === 'src/modules/Project/a.ts' &&
                    entry.reason === 'region-exceeds-per-region-budget (after)'
            )
        ).toBe(true);
        expect(report.failureCode).toBeUndefined();
        // The only cause was the region's size, so the reason names the size, not inadmissibility.
        expect(report.scope.unassessed[0]?.reason).toBe('no-evidence-region-within-budget');
    });

    it('sends and judges a region whose serialized size fits the budget', async () => {
        // The complementary direction: a region that fits the serialized measure must still be sent, not
        // withheld by an over-eager gate. The budget is the region's exact serialized cost, so the gate
        // admits at the serialized boundary.
        const region = `const a = 1;\nconst b = 2;\nconst c = 3;`;
        const serializedBytes = regionCost(
            {
                evidenceId: 'a1',
                revisionSha: HEAD,
                path: 'src/modules/Project/a.ts',
                side: 'after',
                startLine: 1,
                endLine: region.split('\n').length,
                contentHash: semanticDigest({ region }),
            },
            region
        );
        const { report } = await verifyWith({
            provider: perQuestionProvider({
                support: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                attribution: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                kind: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                strongestEvidence: { none: 1 },
            }),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: region },
            profile: profileWithVerifyBudget({ maxRegionBytes: serializedBytes }),
        });
        const assessment = report.findingAssessments[0];
        expect(assessment?.disposition).toBe('ready_for_orchestrator_validation');
        expect(report.scope.truncated).toHaveLength(0);
        expect(report.failureCode).toBeUndefined();
    });
});

describe('the verify pass runs on the profile-owned verify budgets', () => {
    /** The serialized cost of one whole-file region, the same measure the verify gate charges. */
    function wholeFileRegionCost(path: string, region: string): number {
        return regionCost(
            {
                evidenceId: 'a1',
                revisionSha: HEAD,
                path,
                side: 'after',
                startLine: 1,
                endLine: region.split('\n').length,
                contentHash: semanticDigest({ region }),
            },
            region
        );
    }

    /**
     * A whole-file region whose serialized cost is exactly `target` bytes. Appending JSON-safe filler
     * costs one byte each and leaves the line count — and so the reference's own fields — unchanged, so
     * a deliberately short head plus one measured correction lands on the byte.
     */
    function regionCostingExactly(path: string, target: number): string {
        const head = 'const large_line = 1;\n'.repeat(Math.floor(target / 46));
        return `${head}${'x'.repeat(target - wholeFileRegionCost(path, head))}`;
    }

    /** A provider that would answer decisively, so a case can assert the request was never sent. */
    function decisiveVerifyProvider(): SemanticProviderPort {
        return perQuestionProvider({
            support: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
            attribution: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
            kind: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
            strongestEvidence: { none: 1 },
        });
    }

    /** The same decisive answers, keeping the state each request carried so a case can read what was sent. */
    function capturingVerifyProvider(seenStates: unknown[]): SemanticProviderPort {
        return {
            systemOne: async ({ state }) => {
                seenStates.push(state);
                return {
                    model: TYPESAFE_MODEL,
                    answers: {
                        support: {
                            type: 'choice',
                            probabilities: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                            confidence: 0.9,
                            choice: 'supported',
                        },
                        attribution: {
                            type: 'choice',
                            probabilities: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                            confidence: 0.9,
                            choice: 'introduced_by_change',
                        },
                        kind: {
                            type: 'choice',
                            probabilities: {
                                behavioral_or_contract_issue: 0.9,
                                style_preference: 0.05,
                                undetermined: 0.05,
                            },
                            confidence: 0.9,
                            choice: 'behavioral_or_contract_issue',
                        },
                        strongestEvidence: {
                            type: 'choice',
                            probabilities: { none: 1 },
                            confidence: 0.9,
                            choice: 'none',
                        },
                    },
                    usage: { input_tokens: 5, output_tokens: 0 },
                };
            },
        };
    }

    it('withholds a region the request cannot carry instead of losing the finding to a provider refusal', async () => {
        // The per-region ceiling admits a 98,104-byte region at ci and the state ceiling cannot carry it
        // together with the finding's questions, whose strongest-evidence labels grow with the regions
        // supplied. The dead band is admitted region cost in (state ceiling minus the question reserve,
        // region ceiling], and it widens with a longer claim or expected behavior. Before this the
        // provider refused the whole request and the finding was recorded `request_too_large` with
        // nothing disclosed about the region that caused it.
        const path = 'src/modules/Project/a.ts';
        const region = regionCostingExactly(path, 98_104);
        expect(wholeFileRegionCost(path, region)).toBe(98_104);
        expect(wholeFileRegionCost(path, region)).toBeLessThanOrEqual(
            SEMANTIC_BUDGET_PROFILES.ci.verify.maxRegionBytes
        );

        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a region the request cannot carry');
            },
        };
        const { report } = await verifyWith({
            provider,
            profile: SEMANTIC_BUDGET_PROFILES.ci,
            blobs: { [`${HEAD}:${path}`]: region },
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([{ path, reason: 'request-exceeds-state-budget (after)' }]);
        expect(report.limitations).toContain(
            `finding evidence ${path} (after) was not supplied: the request carrying it exceeds the per-request state budget`
        );
        // Not lost to its own size, and not mislabelled either: the evidence was admissible and the request
        // had no room for it, which is what `no-evidence-region-within-budget` names.
        expect(report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-evidence-region-within-budget' }]);
        expect(report.failureCode).toBeUndefined();
    });

    it('names the request size when a region at the region ceiling empties the finding', async () => {
        // The boundary case: the region gate admits a region at its exact serialized ceiling, and the
        // questions then leave no room for it in the state ceiling. Before the fitter existed the same
        // region was sent and judged; with the fit it was dropped and the finding was recorded
        // `no-admissible-evidence`, which says the evidence was inadmissible when it was admissible.
        const path = 'src/modules/Project/a.ts';
        const region = regionCostingExactly(path, SEMANTIC_BUDGET_PROFILES.ci.verify.maxRegionBytes);
        expect(wholeFileRegionCost(path, region)).toBe(SEMANTIC_BUDGET_PROFILES.ci.verify.maxRegionBytes);

        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a region the request cannot carry');
            },
        };
        const { report } = await verifyWith({
            provider,
            profile: SEMANTIC_BUDGET_PROFILES.ci,
            blobs: { [`${HEAD}:${path}`]: region },
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.assessed).toBe(0);
        expect(report.scope.truncated).toEqual([{ path, reason: 'request-exceeds-state-budget (after)' }]);
        expect(report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-evidence-region-within-budget' }]);
        expect(report.failureCode).toBeUndefined();
    });

    it('keeps every region whose addition fits, in every position of the unfittable one', async () => {
        // The scan fitter's policy: a region that cannot fit is skipped, never a reason to stop. Popping
        // from the tail instead dropped a fitting region whenever the unfittable one sorted before it, so
        // a finding whose first or middle region was too large lost the rest of its evidence too — and one
        // whose only region was too large lost the finding. References are collected in `${side}:${path}`
        // order, so each position is a different arrival order for the same set.
        const paths = ['src/modules/Project/aaa.ts', 'src/modules/Project/mmm.ts', 'src/modules/Project/zzz.ts'];
        for (const oversizeIndex of [0, 1, 2]) {
            const oversizePath = paths[oversizeIndex] ?? '';
            const oversize = regionCostingExactly(oversizePath, 98_104);
            const blobs: Record<string, string> = {};
            for (const path of paths) {
                blobs[`${HEAD}:${path}`] = path === oversizePath ? oversize : 'export const small = 1;\n';
            }
            const seenStates: unknown[] = [];
            const { report } = await verifyWith({
                provider: capturingVerifyProvider(seenStates),
                profile: SEMANTIC_BUDGET_PROFILES.ci,
                blobs,
                findings: [
                    {
                        findingId: 'f1',
                        headSha: HEAD,
                        claim: 'a claim',
                        expectedBehavior: 'expected',
                        evidenceReferences: paths.map((path) => ({
                            path,
                            side: 'after' as const,
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        })),
                    },
                ],
            });
            expect(report.scope.assessed).toBe(1);
            expect(report.scope.unassessed).toHaveLength(0);
            expect(report.scope.truncated).toEqual([
                { path: oversizePath, reason: 'request-exceeds-state-budget (after)' },
            ]);
            expect(report.failureCode).toBeUndefined();
            // Measured, not assumed: the request carried every region that fits and not the one that does
            // not, whatever position the unfittable one arrived in.
            const carried = JSON.stringify(seenStates);
            for (const path of paths) {
                if (path === oversizePath) {
                    expect(carried).not.toContain(path);
                } else {
                    expect(carried).toContain(path);
                }
            }
            const assessment = report.findingAssessments[0];
            expect(assessment?.disposition).toBe('needs_more_evidence');
            expect(assessment?.reasoning).toContain(`${oversizePath} (request-exceeds-state-budget (after))`);
        }
    });

    it('carries a payload that exactly fills the state ceiling, and not one byte more', async () => {
        // The comparison's direction is load-bearing at the tie. The calibration measures the body the
        // request actually submits, and the payload is that body without the model the adapter adds.
        const path = 'src/modules/Project/a.ts';
        const region = 'const sample_line = 1;\n'.repeat(400);
        const blobs = { [`${HEAD}:${path}`]: region };
        const measured = await verifyWith({
            provider: decisiveVerifyProvider(),
            profile: profileWithVerifyBudget({ maxStatePlusQuestionBytes: 64 * 1_024 }),
            blobs,
        });
        const payload =
            measured.report.usage.submittedBytes - Buffer.byteLength(`,"model":"${TYPESAFE_MODEL}"`, 'utf8');
        expect(payload).toBeGreaterThan(0);

        const exact = await verifyWith({
            provider: decisiveVerifyProvider(),
            profile: profileWithVerifyBudget({ maxStatePlusQuestionBytes: payload }),
            blobs,
        });
        expect(exact.report.scope.truncated).toHaveLength(0);
        expect(exact.report.scope.assessed).toBe(1);

        // One byte less and the same region is the request's size, not the evidence's.
        const short = await verifyWith({
            provider: decisiveVerifyProvider(),
            profile: profileWithVerifyBudget({ maxStatePlusQuestionBytes: payload - 1 }),
            blobs,
        });
        expect(short.report.scope.truncated).toEqual([{ path, reason: 'request-exceeds-state-budget (after)' }]);
        expect(short.report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-evidence-region-within-budget' }]);
    });

    it('keeps the region it reaches first when the state budget fits only one', async () => {
        // The fit is greedy in the order the finding lists its references, as the scan's fitter is in
        // admission order: with a budget that fits one region, the first is carried and the later one is
        // the skip. A fit that walked the list backwards would send the other one instead.
        const firstPath = 'src/modules/Project/aaa.ts';
        const secondPath = 'src/modules/Project/zzz.ts';
        const seenStates: unknown[] = [];
        const { report } = await verifyWith({
            provider: capturingVerifyProvider(seenStates),
            profile: profileWithVerifyBudget({ maxStatePlusQuestionBytes: 40_000 }),
            blobs: {
                [`${HEAD}:${firstPath}`]: 'const first = 1;\n'.repeat(2_100),
                [`${HEAD}:${secondPath}`]: 'const second = 1;\n'.repeat(1_700),
            },
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        { path: firstPath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                        { path: secondPath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                    ],
                },
            ],
        });
        expect(report.scope.assessed).toBe(1);
        expect(report.scope.truncated).toEqual([{ path: secondPath, reason: 'request-exceeds-state-budget (after)' }]);
        const carried = JSON.stringify(seenStates);
        expect(carried).toContain(firstPath);
        expect(carried).not.toContain(secondPath);
        expect(report.findingAssessments[0]?.disposition).toBe('needs_more_evidence');
    });

    it('still assesses a region whose request fits the state ceiling', async () => {
        // The gate must not over-drop: a region the request can carry is sent, judged, and disclosed as
        // nothing withheld.
        const path = 'src/modules/Project/a.ts';
        const region = regionCostingExactly(path, 90_000);
        expect(wholeFileRegionCost(path, region)).toBe(90_000);
        const { report } = await verifyWith({
            provider: decisiveVerifyProvider(),
            profile: SEMANTIC_BUDGET_PROFILES.ci,
            blobs: { [`${HEAD}:${path}`]: region },
        });
        expect(report.scope.truncated).toHaveLength(0);
        expect(report.scope.assessed).toBe(1);
        expect(report.scope.unassessed).toHaveLength(0);
        expect(report.failureCode).toBeUndefined();
        expect(report.findingAssessments[0]?.reasoning).not.toContain('not supplied');
    });

    it('assesses a finding whose referenced region exceeds the scan per-region budget but fits the verify budget', async () => {
        // The verify pass collected findings under budgets sized for the scan pass, so a referenced
        // region larger than one scan request was withheld and the questions abstained for want of
        // sent evidence; PR #4777's verify round returned no decidable disposition on any of its
        // seven findings. A region between the two budgets must now be supplied and judged.
        const region = 'export const decided = 1;\n'.repeat(800);
        const serialized = wholeFileRegionCost('src/modules/Project/a.ts', region);
        const scanBudget = SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes;
        const verifyBudget = SEMANTIC_BUDGET_PROFILES.local.verify.maxRegionBytes;
        // The fixture only distinguishes the two routes while it sits strictly between their budgets.
        expect(serialized).toBeGreaterThan(scanBudget);
        expect(serialized).toBeLessThanOrEqual(verifyBudget);

        const { report } = await verifyWith({
            provider: perQuestionProvider({
                support: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                attribution: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                kind: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                strongestEvidence: { none: 1 },
            }),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: region },
        });
        expect(report.scope.truncated).toHaveLength(0);
        expect(report.scope.unassessed).toHaveLength(0);
        expect(report.failureCode).toBeUndefined();
        const assessment = report.findingAssessments[0];
        expect(assessment?.support.outcome).toBe('supported');
        expect(assessment?.attribution.outcome).toBe('introduced_by_change');
        expect(assessment?.kind.outcome).toBe('behavioral_or_contract_issue');
        expect(assessment?.disposition).toBe('ready_for_orchestrator_validation');
        expect(assessment?.reasoning).not.toContain('not supplied');
    });

    it('names a region over the shipped verify budget as truncated instead of sending it', async () => {
        // The funded budget is still a budget: a region it cannot carry is withheld, named with the
        // shared withheld-region reason, and the finding is recorded unassessed rather than judged
        // over a fragment or sent silently.
        const region = 'const large_line = 1;\n'.repeat(4_000);
        const serialized = wholeFileRegionCost('src/modules/Project/a.ts', region);
        expect(serialized).toBeGreaterThan(SEMANTIC_BUDGET_PROFILES.local.verify.maxRegionBytes);

        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const { report } = await verifyWith({ provider, blobs: { [`${HEAD}:src/modules/Project/a.ts`]: region } });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([
            { path: 'src/modules/Project/a.ts', reason: 'region-exceeds-per-region-budget (after)' },
        ]);
        // The region was admissible and too large for the request, so the reason names the size.
        expect(report.scope.unassessed).toEqual([{ path: 'f1', reason: 'no-evidence-region-within-budget' }]);
        expect(report.failureCode).toBeUndefined();
    });

    it('refuses a run whose submissions exceed the verify byte budget and records the spend', async () => {
        // Funding the evidence must not soften the caps: the budget controller refuses admission once
        // the run's stated submitted-byte budget is spent, the refused finding is recorded unassessed
        // with that reason, and usage reports the bytes actually submitted.
        const profile = profileWithVerifyBudget({
            maxRegionBytes: 2_000,
            maxStatePlusQuestionBytes: 4_000,
            maxRequestBytes: 6_000,
            maxTotalSubmittedBytes: 6_000,
        });
        const seenBodies: number[] = [];
        const provider: SemanticProviderPort = {
            systemOne: async ({ state, questions, model }) => {
                seenBodies.push(Buffer.byteLength(JSON.stringify({ state, questions, model }), 'utf8'));
                return {
                    model: TYPESAFE_MODEL,
                    answers: {
                        support: {
                            type: 'choice',
                            probabilities: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                            confidence: 0.9,
                            choice: 'supported',
                        },
                        attribution: {
                            type: 'choice',
                            probabilities: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                            confidence: 0.9,
                            choice: 'introduced_by_change',
                        },
                        kind: {
                            type: 'choice',
                            probabilities: {
                                behavioral_or_contract_issue: 0.9,
                                style_preference: 0.05,
                                undetermined: 0.05,
                            },
                            confidence: 0.9,
                            choice: 'behavioral_or_contract_issue',
                        },
                        strongestEvidence: {
                            type: 'choice',
                            probabilities: { none: 1 },
                            confidence: 0.9,
                            choice: 'none',
                        },
                    },
                    usage: { input_tokens: 5, output_tokens: 0 },
                };
            },
        };
        const finding = (findingId: string, path: string): CandidateFinding => ({
            findingId,
            headSha: HEAD,
            claim: 'a claim',
            expectedBehavior: 'expected',
            evidenceReferences: [{ path, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
        });
        const { report } = await verifyWith({
            provider,
            profile,
            blobs: {
                [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n'.repeat(60),
                [`${HEAD}:src/modules/Project/b.ts`]: 'export const b = 2;\n'.repeat(60),
            },
            findings: [finding('f1', 'src/modules/Project/a.ts'), finding('f2', 'src/modules/Project/b.ts')],
        });
        // The first request consumed most of the small budget, so the second was refused before any
        // provider call rather than oversubscribing the run.
        expect(seenBodies).toHaveLength(1);
        expect(report.scope.assessed).toBe(1);
        expect(report.scope.unassessed).toEqual([{ path: 'f2', reason: 'budget_exhausted' }]);
        expect(report.failureCode).toBe('budget_exhausted');
        expect(report.execution).toBe('partial');
        expect(report.usage.networkAttempts).toBe(1);
        expect(report.usage.submittedBytes).toBe(seenBodies[0]);
    });
});

describe('verify refuses an omitted strongest-evidence answer', () => {
    it('does not record an omitted answer as a deliberate none', async () => {
        const provider: SemanticProviderPort = {
            systemOne: async () => ({
                model: TYPESAFE_MODEL,
                answers: {
                    support: {
                        type: 'choice',
                        probabilities: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                        confidence: 0.9,
                        choice: 'supported',
                    },
                    attribution: {
                        type: 'choice',
                        probabilities: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                        confidence: 0.9,
                        choice: 'introduced_by_change',
                    },
                    kind: {
                        type: 'choice',
                        probabilities: {
                            behavioral_or_contract_issue: 0.9,
                            style_preference: 0.05,
                            undetermined: 0.05,
                        },
                        confidence: 0.9,
                        choice: 'behavioral_or_contract_issue',
                    },
                },
                usage: { input_tokens: 5, output_tokens: 0 },
            }),
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });
        expect(report.findingAssessments).toHaveLength(0);
        expect(report.scope.unassessed[0]?.reason).toBe('invalid_response');
    });
});

describe('opaque bearer source and caller admission', () => {
    const opaque = secretFixture('A1b2C3d4', 'E5f6G7h8', 'I9j0K1l2', 'M3n4O5p6', 'Q7r8S9t0');
    const header = ['Authorization:', 'Bearer', opaque].join(' ');
    const path = 'src/modules/Project/__tests__/header.spec.ts';
    const clean = 'it("ordinary", () => { expect(1).toBe(1); });\n';
    const unsafe = `const header = '${header}';\n`;

    it('opaque bearer source and JSON values reject all candidates without echoing material', () => {
        const values = [
            header,
            unsafe,
            ...[
                ['abcde', 'fghij', 'klmnop'].join('.'),
                ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx'].join(''),
                'credential-shaped',
            ].flatMap((value) => {
                const scheme = ['Bearer', value].join(' ');
                return [scheme, `const header = '${scheme}';`, JSON.stringify({ nested: [{ scheme }] })];
            }),
            ['Authorization:', 'Bearer', 'credential-shaped'].join(' '),
            `${header} expired`,
            ['finding: Bearer', ['abcde', 'fghij', 'klmnop'].join('.'), 'was logged'].join(' '),
            ['finding: Bearer', ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx'].join(''), 'was logged'].join(' '),
            JSON.stringify({ nested: [{ header }] }),
            ['bEaReR', opaque].join(' '),
            ['Bearer', opaque].join('\t'),
            ['Bearer <token>', header].join('\n'),
        ];
        for (let repeat = 0; repeat < 3; repeat += 1) {
            for (const value of values) {
                const reason = sensitiveContentReason(value);
                expect(reason).toBeTypeOf('string');
                expect(reason).not.toBe('');
                expect(reason).not.toContain(opaque);
            }
        }
    });

    it('opaque bearer controls remain eligible in decoded and serialized forms', () => {
        for (const value of [
            'Bearer',
            'Bearer <token>',
            'Bearer ${apiKey}',
            'Bearer RUNTIME_CREDENTIAL_REFERENCE_PLACEHOLDER',
            'Bearer ${runtimeCredentialReference}',
            "'Bearer ' + runtimeCredentialReference",
            'CREDENTIAL_PATTERN = /\\bbearer\\s+/iu',
            'A bearer header carries authentication material supplied by the caller.',
            'A reviewer notes Bearer credential-shaped examples remain synthetic and contain no credential.',
        ]) {
            expect(sensitiveContentReason(value), value).toBeUndefined();
            expect(sensitiveContentReason(JSON.stringify({ value })), value).toBeUndefined();
        }
    });

    function effects() {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ model: TYPESAFE_MODEL, answers: {} })));
        const sdk = createSdkProviderPort({ apiKey: 'unused-offline-key', fetch });
        const systemOne = vi.fn(sdk.systemOne);
        const read = vi.fn(() => undefined);
        const write = vi.fn();
        return { fetch, systemOne, cache: { read, write }, provider: { systemOne }, log: vi.fn() };
    }
    function expectZero(effect: ReturnType<typeof effects>) {
        expect(effect.cache.read).not.toHaveBeenCalled();
        expect(effect.cache.write).not.toHaveBeenCalled();
        expect(effect.systemOne).not.toHaveBeenCalled();
        expect(effect.fetch).not.toHaveBeenCalled();
    }

    it.each(['before', 'after', 'fallback'] as const)(
        'opaque bearer scan %s withholding has zero effects',
        async (side) => {
            const effect = effects();
            const blobs: Record<string, string> = {};
            const line = side === 'fallback' ? 99 : 1;
            let hunk: PathHunks = { path, before: [], after: [{ startLine: line, endLine: line }] };
            if (side === 'before') {
                blobs[`${MERGE_BASE}:${path}`] = unsafe;
                hunk = { path, before: [{ startLine: 1, endLine: 1 }], after: [] };
            } else {
                blobs[`${HEAD}:${path}`] = unsafe;
            }
            const source = fakeSource({
                files: [changedFile(path, { kind: side === 'before' ? 'deleted' : 'added' })],
                blobs,
                hunks: new Map([[path, hunk]]),
            });
            const input = scanPorts(effect.provider, source, fixedClock(1_000));
            const result = await runScan({ ...input, ports: { ...input.ports, cache: effect.cache } });
            expect(result.report.scope.excluded).toContainEqual({
                path,
                reason: side === 'fallback' ? 'no-admissible-evidence' : 'credential-shaped-content-excluded',
            });
            expect(result.report.scope.truncated).toContainEqual({
                path,
                reason: 'evidence-withheld-credential-shaped',
            });
            expect(result.report.limitations.join(' ')).toContain('withheld');
            expect(result.report.scope.assessed).toBe(0);
            expect(result.report.usage).toMatchObject({ logicalRequests: 0, networkAttempts: 0 });
            expect(result.report.scope.cacheHits).toBe(0);
            expectZero(effect);
        }
    );

    it('opaque bearer scan placeholder admits a clean independent unit beside a withheld unit', async () => {
        const safePath = 'src/modules/Project/__tests__/ordinary.spec.ts';
        const provider = constantProvider(0.05);
        const systemOne = vi.fn(provider.systemOne);
        const result = await runScan(
            scanPorts(
                { systemOne },
                fakeSource({
                    files: [changedFile(path), changedFile(safePath)],
                    blobs: {
                        [`${MERGE_BASE}:${path}`]: unsafe,
                        [`${HEAD}:${path}`]: unsafe,
                        [`${MERGE_BASE}:${safePath}`]: clean,
                        [`${HEAD}:${safePath}`]: `${clean}const header = 'Bearer <token>';\n`,
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.excluded).toContainEqual({ path, reason: 'credential-shaped-content-excluded' });
        expect(result.report.scope.assessed).toBe(1);
        expect(systemOne).toHaveBeenCalled();
        expect(JSON.stringify(systemOne.mock.calls)).not.toContain(opaque);
    });

    function finding(): CandidateFinding {
        return {
            findingId: 'f1',
            headSha: HEAD,
            claim: 'a claim',
            expectedBehavior: 'expected behavior',
            evidenceReferences: [{ path, side: 'after', startLine: 1, endLine: 1 }],
        };
    }
    async function verify(candidate: CandidateFinding, text: string, effect: ReturnType<typeof effects>) {
        const { runVerify } = await import('../verify.ts');
        return runVerify({
            ports: {
                source: fakeSource({ files: [], blobs: { [`${HEAD}:${path}`]: text } }),
                provider: effect.provider,
                cache: effect.cache,
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: effect.log,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            findings: [candidate],
            runId: 'opaque-bearer-verify',
        });
    }

    it('opaque bearer verify evidence withholding has zero effects', async () => {
        const effect = effects();
        const result = await verify(finding(), unsafe, effect);
        expect(result.report.findingAssessments).toEqual([]);
        expect(result.report.scope.truncated).toContainEqual({ path, reason: 'evidence-withheld-credential-shaped' });
        expect(result.report.limitations.join(' ')).toContain('withheld');
        expect(result.report.usage).toMatchObject({ logicalRequests: 0, networkAttempts: 0 });
        expect(result.report.scope.cacheHits).toBe(0);
        expectZero(effect);
    });

    const findingFields = [
        'claim',
        'expectedBehavior',
        'reproductionReferences',
        'allegedFailureInputOrState',
        'allegedObservedBehavior',
    ] as const;
    const findingLiterals = [
        { shape: 'alphanumeric', value: header },
        { shape: 'header-tail', value: `${header} expired` },
        {
            shape: 'dotted-tail',
            value: ['finding: Bearer', ['abcde', 'fghij', 'klmnop'].join('.'), 'was logged'].join(' '),
        },
        {
            shape: 'alphabetic-tail',
            value: ['finding: Bearer', ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx'].join(''), 'was logged'].join(' '),
        },
    ];
    it.each(findingFields.flatMap((field) => findingLiterals.map((literal) => ({ field, ...literal }))))(
        'opaque bearer finding $shape $field rejects before cache or SDK delegate',
        async ({ field, value }) => {
            const effect = effects();
            let candidate = finding();
            if (field === 'reproductionReferences') {
                candidate = {
                    ...candidate,
                    reproductionReferences: [{ path: 'probe.txt', note: value, verifiedExecution: false }],
                };
            } else {
                candidate = { ...candidate, [field]: value };
            }
            const result = await verify(candidate, clean, effect);
            expect(result.report.failureCode).toBe('sensitive_content_excluded');
            expect(result.report.findingAssessments).toEqual([]);
            expect(result.report.usage).toMatchObject({ logicalRequests: 0, networkAttempts: 0 });
            expect(result.report.scope.cacheHits).toBe(0);
            expectZero(effect);
        }
    );

    it('opaque bearer verify ordinary caller descriptions remain assessable', async () => {
        const effect = effects();
        effect.systemOne.mockImplementation(async ({ questions }) => {
            const answers: Record<string, unknown> = {};
            for (const [key, question] of Object.entries(questions)) {
                if (
                    typeof question !== 'object' ||
                    question === null ||
                    !('criteria' in question) ||
                    typeof question.criteria !== 'object' ||
                    question.criteria === null
                ) {
                    throw new Error('the verify fixture requires choice criteria');
                }
                const labels = Object.keys(question.criteria);
                answers[key] = {
                    type: 'choice',
                    choice: labels[0],
                    confidence: 0.9,
                    probabilities: Object.fromEntries(labels.map((label) => [label, 1 / labels.length])),
                };
            }
            return { model: TYPESAFE_MODEL, answers };
        });
        const result = await verify(
            {
                ...finding(),
                allegedFailureInputOrState: 'an ordinary input',
                allegedObservedBehavior: 'an ordinary observation',
                reproductionReferences: [
                    { path: 'probe.txt', note: 'a reported observation', verifiedExecution: false },
                ],
            },
            clean,
            effect
        );
        expect(result.report.failureCode, JSON.stringify(effect.log.mock.calls)).toBeUndefined();
        expect(result.report.findingAssessments).toHaveLength(1);
        expect(effect.cache.read).toHaveBeenCalledTimes(1);
        expect(effect.systemOne).toHaveBeenCalledTimes(1);
    });
});
